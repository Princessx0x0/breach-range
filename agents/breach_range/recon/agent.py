"""Recon: read the sandbox project and build graph/current.

Deterministic by design. Recon reads real GCP config and assembles nodes and edges; it does
not reason with an LLM, so the graph is stable round to round. Misconfig tags come from the
resource label `misconfig=mc-0N` (buckets) or from the binding pattern (IAM edges), never a
guess.
"""

from __future__ import annotations

import json
from typing import Optional

from breach_range.shared import schema
from breach_range.shared.schema import Node, Edge, Graph, NodeKind, Relation, Agent, Action, Status
from breach_range.tools import gcp_readonly, firestore_io

# id prefix per node kind (matches the schema examples: serviceAccount -> "sa").
_PREFIX = {
    NodeKind.SERVICE_ACCOUNT: "sa",
    NodeKind.BUCKET: "bucket",
    NodeKind.INSTANCE: "instance",
    NodeKind.FIREWALL: "fw",
    NodeKind.KEY: "key",
    NodeKind.ROLE: "role",
    NodeKind.PROJECT: "project",
}

HIGH_VALUE_ROLES = {"roles/owner", "roles/editor"}


def _sa_short(email: str) -> str:
    return email.split("@", 1)[0]


def _node_id(kind: NodeKind, short: str) -> str:
    return f"{_PREFIX[kind]}:{short}"


def _looks_like_key_file(object_name: str) -> bool:
    n = object_name.lower()
    return n.endswith(".json") and ("key" in n or "credential" in n or "sa" in n)


def build_graph(round: int) -> Graph:
    """Read GCP and assemble the attack graph. reachable defaults False (Attacker sets it)."""
    sa_emails = [a["email"] for a in gcp_readonly.list_service_accounts()]

    nodes: dict[str, Node] = {}
    edges: list[Edge] = []
    edge_seq = 0

    def next_edge_id() -> str:
        nonlocal edge_seq
        edge_seq += 1
        return f"e{edge_seq}"

    def ensure_sa_node(email: str) -> str:
        short = _sa_short(email)
        nid = _node_id(NodeKind.SERVICE_ACCOUNT, short)
        if nid not in nodes:
            roles = gcp_readonly.roles_for_member(f"serviceAccount:{email}")
            nodes[nid] = Node(
                id=nid,
                kind=NodeKind.SERVICE_ACCOUNT,
                name=email,
                fromMisconfig=None,
                labels={"roles": roles},
            )
        return nid

    # --- MC-01: public bucket leaking a service-account key ---
    for bucket in gcp_readonly.list_buckets():
        name = bucket["name"]
        if not gcp_readonly.bucket_is_public(name):
            continue
        label = (bucket.get("labels") or {}).get("misconfig")
        from_misconfig = label.upper() if label else None
        # strip the "<project>-" prefix for a readable short name
        short = name[len(gcp_readonly.PROJECT_ID) + 1:] if name.startswith(gcp_readonly.PROJECT_ID + "-") else name
        bnid = _node_id(NodeKind.BUCKET, short)
        nodes[bnid] = Node(
            id=bnid,
            kind=NodeKind.BUCKET,
            name=name,
            fromMisconfig=from_misconfig,
            labels={"iamPublic": True},
        )
        # The leaked object names a client_email; draw a leaksKey edge to that SA.
        for obj in gcp_readonly.list_bucket_objects(name):
            if not _looks_like_key_file(obj):
                continue
            try:
                content = _read_public_object(name, obj)
                client_email = json.loads(content).get("client_email")
            except Exception:
                client_email = None
            if client_email and client_email in sa_emails:
                sid = ensure_sa_node(client_email)
                edges.append(Edge(
                    id=next_edge_id(),
                    from_=bnid,
                    to=sid,
                    relation=Relation.LEAKS_KEY,
                    viaMisconfig=from_misconfig,
                ))

    # --- MC-02: tokenCreator bindings on a service account ---
    for email in sa_emails:
        if email.endswith(f"-agent@{gcp_readonly.PROJECT_ID}.iam.gserviceaccount.com"):
            continue  # our own infra SAs are not attack targets
        policy = gcp_readonly.get_sa_iam_policy(email)
        for binding in policy.get("bindings", []):
            if binding.get("role") != "roles/iam.serviceAccountTokenCreator":
                continue
            target_sid = ensure_sa_node(email)
            for member in binding.get("members", []):
                if not member.startswith("serviceAccount:"):
                    continue
                src_email = member.split(":", 1)[1]
                if src_email not in sa_emails:
                    continue
                src_sid = ensure_sa_node(src_email)
                edges.append(Edge(
                    id=next_edge_id(),
                    from_=src_sid,
                    to=target_sid,
                    relation=Relation.TOKEN_CREATOR,
                    viaMisconfig="MC-02",
                ))

    # Drop isolated agent-infra SA nodes that no edge touches and that hold no high-value role.
    touched = {e.from_ for e in edges} | {e.to for e in edges}
    pruned = {
        nid: n for nid, n in nodes.items()
        if nid in touched or (set(n.labels.get("roles", [])) & HIGH_VALUE_ROLES)
    }

    return Graph(round=round, score=0, nodes=list(pruned.values()), edges=edges)


def _read_public_object(bucket: str, obj: str) -> str:
    svc = gcp_readonly._svc("storage", "v1")
    return svc.objects().get_media(bucket=bucket, object=obj).execute().decode("utf-8")


def run_recon(round: int = 1) -> Graph:
    """Build the graph, write graph/current, and log recon.complete."""
    graph = build_graph(round)
    firestore_io.write_graph(graph)
    firestore_io.append_event(
        round=round,
        agent=Agent.RECON,
        action=Action.RECON_COMPLETE,
        target="graph:current",
        status=Status.VERIFIED,
        payload={"nodes": len(graph.nodes), "edges": len(graph.edges)},
        result=f"built graph: {len(graph.nodes)} nodes, {len(graph.edges)} edges",
    )
    return graph


if __name__ == "__main__":
    import sys
    from breach_range.shared.config import ensure_vertex_env

    ensure_vertex_env()
    rnd = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    g = run_recon(rnd)
    print(json.dumps(g.to_dict(), indent=2, default=str))
