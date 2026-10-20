"""Referee: independently confirm or reject each path the Attacker claimed.

The Referee is the honest scorekeeper. It reads the Attacker's claims from the event
log to learn WHAT was claimed, then re-derives the truth itself through read-only checks
in tools/verify.py, re-reading ground truth rather than trusting the claim. A path counts
only if every edge on it independently verifies; one broken link rejects the whole path.

It then corrects the reachable flags on graph/current (a node stays reachable only if it
sits on a verified path) and sets the score. Per the schema invariant, only the Referee
writes `verified` / `rejected`.
"""

from __future__ import annotations

from breach_range.shared.schema import (
    Action,
    Agent,
    Edge,
    Graph,
    Node,
    Path,
    Relation,
    Status,
)
from breach_range.tools import firestore_io, verify


def verify_edge(edge: Edge, nodes_by_id: dict[str, Node]) -> tuple[bool, str]:
    """Re-check one allow-edge against ground truth. Relations we have no independent
    check for are treated as unverified: the Referee never confirms what it cannot see."""
    src = nodes_by_id[edge.from_]
    dst = nodes_by_id[edge.to]
    if edge.relation == Relation.LEAKS_KEY:
        return verify.verify_leaks_key(src.name, dst.name)
    if edge.relation == Relation.TOKEN_CREATOR:
        return verify.verify_token_creator(src.name, dst.name)
    if edge.relation == Relation.ALLOWS_INGRESS:
        return verify.verify_ingress(src.labels, dst.labels.get("endpoint"))
    return False, f"no independent check for relation '{edge.relation.value}'"


def verify_path(
    path: Path, edges_by_id: dict[str, Edge], nodes_by_id: dict[str, Node]
) -> tuple[bool, list[str]]:
    """A path verifies only if every edge does. Returns (ok, per-edge details); on
    failure the last detail is the edge that broke the chain."""
    details: list[str] = []
    for eid in path.edges:
        ok, detail = verify_edge(edges_by_id[eid], nodes_by_id)
        details.append(detail)
        if not ok:
            return False, details
    return True, details


def apply_verdicts(
    graph: Graph, verdicts: dict[str, tuple[bool, Path, list[str]]]
) -> int:
    """Correct reachable flags and set the score. Pure: no I/O.

    A node is reachable only if it lies on at least one verified path. The score is the
    count of distinct misconfigs on verified paths -- the 'reachable misconfigs this
    round' number the scoreboard plots down to zero. (The schema's prose invariant
    counts reachable nodes; the schema example and the strategy doc both score by
    misconfig, which is the headline metric, so we follow that.)"""
    reachable: set[str] = set()
    misconfigs: set[str] = set()
    for ok, path, node_ids in verdicts.values():
        if ok:
            reachable.update(node_ids)
            misconfigs.update(path.misconfigs)
    for n in graph.nodes:
        n.reachable = n.id in reachable
    graph.score = len(misconfigs)
    return graph.score


def _verdict_result(ok: bool, path: Path, details: list[str]) -> str:
    if ok:
        chain = " -> ".join(path.misconfigs) if path.misconfigs else "direct"
        return f"reachable via {chain}"
    return f"rejected: {details[-1] if details else 'no verifiable edge'}"


def run_referee(round: int = 1) -> int:
    """Verify every claim from this round, write a verdict event per path, correct the
    graph, and return the new score."""
    graph = firestore_io.get_graph()
    if graph is None:
        raise RuntimeError("no graph/current; run Recon first")

    edges_by_id = {e.id: e for e in graph.edges}
    nodes_by_id = {n.id: n for n in graph.nodes}

    from breach_range.attacker.agent import path_node_ids

    verdicts: dict[str, tuple[bool, Path, list[str]]] = {}
    for ev in firestore_io.list_events(round, Action.ATTACKER_CLAIM):
        path = Path.from_dict(ev["payload"]["path"])
        ok, details = verify_path(path, edges_by_id, nodes_by_id)
        verdicts[path.id] = (ok, path, path_node_ids(path, edges_by_id))
        firestore_io.append_event(
            round=round,
            agent=Agent.REFEREE,
            action=Action.REFEREE_VERIFIED if ok else Action.REFEREE_REJECTED,
            target=f"path:{path.id}",
            status=Status.VERIFIED if ok else Status.REJECTED,
            payload={"path": path.to_dict(), "checks": details},
            result=_verdict_result(ok, path, details),
        )

    score = apply_verdicts(graph, verdicts)
    firestore_io.write_graph(graph)
    return score


if __name__ == "__main__":  # pragma: no cover
    import sys

    from breach_range.shared.config import ensure_vertex_env

    ensure_vertex_env()
    rnd = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    print(f"score after round {rnd}: {run_referee(rnd)}")
