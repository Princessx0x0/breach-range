"""Defender: pick the highest-impact verified path, propose a minimal Terraform patch,
and apply it once a human approves.

The Defender is the only agent that can change the sandbox, and even it cannot act alone:
it proposes and then waits. The approval is a separate human action (the dashboard's
approval card, or `grant_approval` from a CLI in step mode); applying is gated in
tools/terraform.py, not here. This is the separation-of-duties control, made of three
events: defender.proposed -> approval.requested -> (human) approval.granted -> defender.applied.

The Defender patches only what the Referee verified. It never touches a rejected or merely
claimed path, so an over-claim the Referee threw out is never acted on.
"""

from __future__ import annotations

from typing import Optional

from breach_range.shared.schema import Action, Agent, Path, Status
from breach_range.tools import firestore_io, terraform


def choose_path(paths: list[Path]) -> Path:
    """Highest impact first: the path exploiting the most misconfigs, then the longest
    chain. Closing its entry edge collapses the most reach for one change."""
    return max(paths, key=lambda p: (len(p.misconfigs), len(p.edges), p.id))


def _verified_paths(round: int) -> list[Path]:
    return [
        Path.from_dict(ev["payload"]["path"])
        for ev in firestore_io.list_events(round, Action.REFEREE_VERIFIED)
    ]


def propose(round: int = 1) -> Optional[terraform.Patch]:
    """Choose a verified path, build a minimal patch, and request approval. Writes
    defender.proposed (with the diff) and approval.requested, then stops. Returns the
    patch awaiting approval, or None if there is nothing verified to patch."""
    verified = _verified_paths(round)
    if not verified:
        return None

    path = choose_path(verified)
    patch = terraform.build_patch(path)
    target = patch.target_event

    firestore_io.append_event(
        round=round,
        agent=Agent.DEFENDER,
        action=Action.DEFENDER_PROPOSED,
        target=target,
        status=Status.PENDING,
        payload={
            "diff": patch.remediation.diff,
            "targets": [patch.remediation.target],
            "pathId": path.id,
            "misconfig": patch.remediation.misconfig,
        },
        result=patch.remediation.title,
    )
    firestore_io.append_event(
        round=round,
        agent=Agent.DEFENDER,
        action=Action.APPROVAL_REQUESTED,
        target=target,
        status=Status.PENDING,
        payload={"pathId": path.id, "misconfig": patch.remediation.misconfig},
        result=f"awaiting approval to {patch.remediation.summary}",
    )
    return patch


def grant_approval(round: int, target: str, approver: str = "human") -> None:
    """Record a human approval for a proposed patch. The dashboard's approval card calls
    this (via its CopilotKit action); it is also the step-mode CLI's approve button. It
    is deliberately separate from the Defender: the agent never approves its own patch."""
    firestore_io.append_event(
        round=round,
        agent=Agent.DEFENDER,
        action=Action.APPROVAL_GRANTED,
        target=target,
        status=Status.APPLIED,
        payload={"approver": approver},
        result=f"approved by {approver}",
    )


def apply(round: int, patch: terraform.Patch) -> None:
    """Apply an approved patch. Gating and the defender.applied record live in
    tools/terraform.py, so this cannot proceed without a prior approval.granted."""
    terraform.apply(round, patch)


if __name__ == "__main__":  # pragma: no cover
    import sys

    from breach_range.shared.config import ensure_vertex_env

    ensure_vertex_env()
    rnd = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    proposed = propose(rnd)
    if proposed is None:
        print("nothing verified to patch")
    else:
        print(f"proposed {proposed.remediation.misconfig}: {proposed.remediation.title}")
        print(proposed.remediation.diff)
        if "--approve-and-apply" in sys.argv:  # step-mode convenience only
            grant_approval(rnd, proposed.target_event)
            apply(rnd, proposed)
            print("applied")
