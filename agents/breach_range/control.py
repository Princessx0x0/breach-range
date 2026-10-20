"""Local step runner for the dashboard — the rehearsal driver.

Exposes the round loop over HTTP so the control room's buttons drive the agents one step
at a time. Agent Runtime hosts the real loop in production; this is for driving the demo.

It keeps a small in-memory cursor for where we are in the loop. (Progress can't be read
back from the event log alone: in a patched round the Attacker finds nothing and the
Referee has nothing to rule on, so neither writes an event -- the cursor is what lets the
game still advance to "secured".) Firestore stays the source of truth for the data the
dashboard shows and for the human approval; the cursor only tracks whose turn it is.

Endpoints (all return the current state as JSON):
  GET  /state   what just happened and what the next step is
  POST /step    run the next agent
  POST /round   run the current round up to the approval gate
  POST /reset   clear the log, restore the lit sandbox, start again
"""

from __future__ import annotations

import json
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from breach_range.shared.schema import Action
from breach_range.tools import firestore_io, terraform
from breach_range.recon.agent import run_recon
from breach_range.attacker.agent import run_attacker
from breach_range.referee.agent import run_referee
from breach_range.defender.agent import propose, apply as defender_apply

STEP_COUNT = 4  # recon, attacker, referee, defender (propose -> approve -> apply)

# stage -> (step number for the progress dots, button/next label)
STAGE_META = {
    "recon":     (1, "Recon maps the project"),
    "attacker":  (2, "Attacker finds escalation paths"),
    "referee":   (3, "Referee verifies the paths"),
    "propose":   (4, "Defender proposes a fix"),
    "await":     (4, "Approve the fix to apply it"),
    "apply":     (4, "Apply the approved fix"),
    "game_over": (4, "Nothing is reachable"),
}

_cursor: dict = {
    "round": 1, "stage": "recon", "target": None, "patch": None,
    "message": "Ready to start round 1.",
}


def _payload() -> dict:
    graph = firestore_io.get_graph()
    stage = _cursor["stage"]
    step, label = STAGE_META[stage]
    status = "awaiting_approval" if stage == "await" else "game_over" if stage == "game_over" else "ready"
    return {
        "round": _cursor["round"], "status": status, "next": stage, "nextLabel": label,
        "stepIndex": step, "stepCount": STEP_COUNT, "score": graph.score if graph else 0,
        "message": _cursor["message"], "target": _cursor["target"],
    }


def step() -> dict:
    rnd, stage = _cursor["round"], _cursor["stage"]

    if stage == "recon":
        g = run_recon(rnd)
        _cursor.update(stage="attacker",
                       message=f"Recon mapped {len(g.nodes)} resources. Let the Attacker look for a way in.")
    elif stage == "attacker":
        paths = run_attacker(rnd)
        _cursor.update(stage="referee", message=(
            f"The Attacker claimed {len(paths)} escalation path(s). The Referee will now check them for real."
            if paths else "The Attacker found no way in. Let the Referee confirm."))
    elif stage == "referee":
        score = run_referee(rnd)
        if score == 0:
            _cursor.update(stage="game_over",
                           message="The Referee could reach nothing. The project is secure — you win.")
        else:
            _cursor.update(stage="propose",
                           message=f"The Referee verified the attack: {score} way(s) in still reachable.")
    elif stage == "propose":
        patch = propose(rnd)
        if patch is None:
            _cursor.update(stage="game_over", message="Nothing left to patch. The project is secure.")
        else:
            _cursor.update(stage="await", target=patch.target_event, patch=patch,
                           message=f"The Defender proposes: {patch.remediation.title}. "
                                   f"Approve it to patch the real project.")
    elif stage == "await":
        # Advance only once a human approval exists in the log; then apply immediately.
        if firestore_io.find_event(Action.APPROVAL_GRANTED, _cursor["target"]):
            _cursor["stage"] = "apply"
            return step()
        _cursor["message"] = "Waiting for a human to approve the fix before anything changes."
    elif stage == "apply":
        defender_apply(rnd, _cursor["patch"])  # gated again inside: needs approval.granted
        _cursor.update(round=rnd + 1, stage="recon", target=None, patch=None,
                       message=f"Round {rnd} complete — the path is closed. "
                               f"Start round {rnd + 1} to watch the score fall.")
    # game_over: nothing to do
    return _payload()


def run_round() -> dict:
    for _ in range(STEP_COUNT + 1):
        if _cursor["stage"] in ("await", "game_over"):
            break
        step()
    return _payload()


def reset() -> dict:
    c = firestore_io.client()
    for coll in ("events", "rounds"):
        for d in c.collection(coll).stream():
            d.reference.delete()
    c.collection("graph").document("current").delete()  # start from an empty board
    # Re-add any seed resource a previous apply removed (the public bucket binding).
    subprocess.run(
        ["terraform", f"-chdir={terraform.SANDBOX_DIR}", "apply", "-auto-approve",
         "-input=false", "-no-color"],
        check=False,
    )
    _cursor.update(round=1, stage="recon", target=None, patch=None,
                   message="Reset. Click Run next step to start round 1.")
    return _payload()


class Handler(BaseHTTPRequestHandler):
    def _send(self, body: dict, code: int = 200):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.rstrip("/") == "/state":
            return self._send(_payload())
        self._send({"error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("content-length", 0) or 0)
        if length:
            self.rfile.read(length)
        route = self.path.rstrip("/")
        try:
            if route == "/step":
                return self._send(step())
            if route == "/round":
                return self._send(run_round())
            if route == "/reset":
                return self._send(reset())
        except Exception as e:  # surface agent errors to the UI instead of a dead button
            return self._send({"status": "error", "message": f"{type(e).__name__}: {e}",
                               "round": _cursor["round"], "next": _cursor["stage"], "nextLabel": "",
                               "stepIndex": 0, "stepCount": STEP_COUNT, "score": 0, "target": None}, 500)
        self._send({"error": "not found"}, 404)

    def log_message(self, *args):
        pass


def main():
    from breach_range.shared.config import ensure_vertex_env
    ensure_vertex_env()
    print("breach-range runner on http://127.0.0.1:8000")
    ThreadingHTTPServer(("127.0.0.1", 8000), Handler).serve_forever()


if __name__ == "__main__":
    main()
