"""The only module that touches Firestore. Every read/write of graph, events and rounds
goes through here, so the data contract stays in one place.

Invariants enforced here, not in prompts:
  - events are append-only: there is no update or delete function.
  - write_graph recomputes `score` as the count of reachable nodes if not given.
"""

from __future__ import annotations

from typing import Any, Optional

from google.cloud import firestore

from breach_range.shared import schema
from breach_range.shared.config import PROJECT_ID

GRAPH_COLLECTION = "graph"
GRAPH_DOC = "current"
EVENTS_COLLECTION = "events"
ROUNDS_COLLECTION = "rounds"

_client: Optional[firestore.Client] = None


def client() -> firestore.Client:
    global _client
    if _client is None:
        _client = firestore.Client(project=PROJECT_ID)
    return _client


# --- graph/current -------------------------------------------------------

def write_graph(graph: schema.Graph) -> None:
    """Overwrite graph/current. Recon rewrites it each round; Attacker/Referee patch
    node flags via this same call after reading it back."""
    data = graph.to_dict()
    data["updatedAt"] = firestore.SERVER_TIMESTAMP
    client().collection(GRAPH_COLLECTION).document(GRAPH_DOC).set(data)


def get_graph() -> Optional[schema.Graph]:
    snap = client().collection(GRAPH_COLLECTION).document(GRAPH_DOC).get()
    if not snap.exists:
        return None
    return schema.Graph.from_dict(snap.to_dict())


# --- events (append-only) ------------------------------------------------

def append_event(
    round: int,
    agent: schema.Agent,
    action: schema.Action,
    target: str,
    status: schema.Status,
    payload: Optional[dict[str, Any]] = None,
    result: Optional[str] = None,
) -> str:
    """Append one immutable event. Returns the new document id.

    There is deliberately no update_event or delete_event: corrections are new events.
    """
    doc = client().collection(EVENTS_COLLECTION).document()
    doc.set(
        {
            "round": round,
            "agent": agent.value,
            "action": action.value,
            "target": target,
            "status": status.value,
            "payload": payload or {},
            "result": result,
            "ts": firestore.SERVER_TIMESTAMP,
        }
    )
    return doc.id


def find_event(action: schema.Action, target: str) -> Optional[dict[str, Any]]:
    """Return the most recent event matching an action + target, or None.

    The Defender uses this to prove an approval.granted exists before applying.
    """
    q = (
        client()
        .collection(EVENTS_COLLECTION)
        .where(filter=firestore.FieldFilter("action", "==", action.value))
        .where(filter=firestore.FieldFilter("target", "==", target))
        .order_by("ts", direction=firestore.Query.DESCENDING)
        .limit(1)
    )
    for snap in q.stream():
        return snap.to_dict()
    return None


# --- rounds --------------------------------------------------------------

def write_round(
    round: int,
    score_before: int,
    score_after: int,
    patch_applied: Optional[str],
) -> None:
    client().collection(ROUNDS_COLLECTION).document(str(round)).set(
        {
            "round": round,
            "scoreBefore": score_before,
            "scoreAfter": score_after,
            "patchApplied": patch_applied,
            "startedAt": firestore.SERVER_TIMESTAMP,
            "endedAt": firestore.SERVER_TIMESTAMP,
        }
    )
