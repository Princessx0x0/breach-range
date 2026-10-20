"""Attacker: chain allow-edges in graph/current into privilege-escalation paths.

Reads only the Firestore graph, never GCP (see Governance: the Attacker has no GCP
access). It reasons over allow-relationships alone and never models deny policies or
VPC-SC; that is deliberate and safe because it only reads, and it keeps the game honest
by surfacing every path for the Referee to then confirm or reject.

Path-finding is a deterministic graph traversal, so the demo claims the same paths every
run. For each path it writes an `attacker.claim` event and marks the path's nodes
reachable on graph/current. It never writes a verdict or a score: status stays `claimed`
until the Referee rules.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable

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
from breach_range.tools import firestore_io

# A path is interesting only if it ends at real power. Mirrors Recon's own list.
HIGH_VALUE_ROLES = {"roles/owner", "roles/editor"}


def _entry_nodes(graph: Graph) -> list[str]:
    """An outsider's starting points: resources reachable with no credentials -- a
    public bucket, or an instance an ingress rule exposes.

    Deliberately NOT 'any node with no incoming edge': a bare service account is a
    source in the graph, but you need credentials to be it, so it is not an outsider
    entry. This is what makes the graph go dark after a patch -- once the Defender
    closes the public bucket, nothing is externally reachable and no path survives,
    rather than the stranded ci-deployer being re-admitted as a phantom entry."""
    ingress_targets = {
        e.to for e in graph.edges if e.relation == Relation.ALLOWS_INGRESS
    }
    return [
        n.id
        for n in graph.nodes
        if n.labels.get("iamPublic") or n.id in ingress_targets
    ]


def _target_nodes(graph: Graph) -> set[str]:
    return {
        n.id
        for n in graph.nodes
        if set(n.labels.get("roles", [])) & HIGH_VALUE_ROLES
    }


def _dfs(
    cur: str,
    targets: set[str],
    adj: dict[str, list[Edge]],
    visited: set[str],
    trail: list[Edge],
    out: list[list[Edge]],
) -> None:
    # Record a path whenever we reach a target, then keep going: a target may itself
    # be a stepping stone to a higher one.
    if trail and cur in targets:
        out.append(list(trail))
    for e in adj.get(cur, []):
        if e.to in visited:
            continue  # simple paths only; no cycles
        visited.add(e.to)
        trail.append(e)
        _dfs(e.to, targets, adj, visited, trail, out)
        trail.pop()
        visited.remove(e.to)


def find_paths(graph: Graph) -> list[Path]:
    """Enumerate simple allow-paths from an entry node to a high-value target."""
    nodes_by_id = {n.id: n for n in graph.nodes}
    adj: dict[str, list[Edge]] = defaultdict(list)
    for e in graph.edges:
        adj[e.from_].append(e)

    targets = _target_nodes(graph)
    paths: list[Path] = []
    seq = 0
    for entry in _entry_nodes(graph):
        edge_lists: list[list[Edge]] = []
        _dfs(entry, targets, adj, {entry}, [], edge_lists)
        for edges in edge_lists:
            seq += 1
            paths.append(
                Path(
                    id=f"p{seq}",
                    edges=[e.id for e in edges],
                    startNode=entry,
                    targetNode=edges[-1].to,
                    misconfigs=_misconfigs_along(entry, edges, nodes_by_id),
                )
            )
    return paths


def _misconfigs_along(
    start: str, edges: list[Edge], nodes_by_id: dict[str, Node]
) -> list[str]:
    """Misconfig ids the path exploits, in order, de-duplicated. Reads the tags Recon
    already set from resource labels; never guesses."""
    out: list[str] = []

    def add(mc: str | None) -> None:
        if mc and mc not in out:
            out.append(mc)

    add(nodes_by_id[start].fromMisconfig)
    for e in edges:
        add(e.viaMisconfig)
        add(nodes_by_id[e.to].fromMisconfig)
    return out


def path_node_ids(path: Path, edges_by_id: dict[str, Edge]) -> list[str]:
    ids = [path.startNode]
    for eid in path.edges:
        ids.append(edges_by_id[eid].to)
    return ids


def _claim_result(path: Path) -> str:
    chain = " -> ".join(path.misconfigs) if path.misconfigs else "direct"
    return f"claims {path.startNode} reaches {path.targetNode} via {chain}"


def run_attacker(round: int = 1) -> list[Path]:
    """Read graph/current, claim every path found, mark their nodes reachable, and
    write the graph back. Score is left to the Referee."""
    graph = firestore_io.get_graph()
    if graph is None:
        raise RuntimeError("no graph/current; run Recon first")

    edges_by_id = {e.id: e for e in graph.edges}
    paths = find_paths(graph)

    reachable: set[str] = set()
    for p in paths:
        reachable.update(path_node_ids(p, edges_by_id))
    for n in graph.nodes:
        n.reachable = n.id in reachable

    # Carry the existing score through unchanged; only the Referee sets it.
    firestore_io.write_graph(graph)

    for p in paths:
        firestore_io.append_event(
            round=round,
            agent=Agent.ATTACKER,
            action=Action.ATTACKER_CLAIM,
            target=f"path:{p.id}",
            status=Status.CLAIMED,
            payload={"path": p.to_dict()},
            result=_claim_result(p),
        )
    return paths


def _iter_paths(paths: Iterable[Path]) -> None:  # pragma: no cover - cli helper
    for p in paths:
        print(f"{p.id}: {p.startNode} -> {p.targetNode}  [{', '.join(p.misconfigs)}]")


if __name__ == "__main__":  # pragma: no cover
    import sys

    from breach_range.shared.config import ensure_vertex_env

    ensure_vertex_env()
    rnd = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    _iter_paths(run_attacker(rnd))
