"""Dataclasses and enums mirroring firestore-schema.json.

This is the Python side of the data contract. The JSON file is the source of truth;
`web/lib/firestore.ts` is the other side. Change the JSON first, then both sides.
`tests/test_schema_drift.py` fails if the enums here stop matching the JSON.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class Agent(str, Enum):
    RECON = "recon"
    ATTACKER = "attacker"
    REFEREE = "referee"
    DEFENDER = "defender"


class Action(str, Enum):
    RECON_COMPLETE = "recon.complete"
    ATTACKER_CLAIM = "attacker.claim"
    REFEREE_VERIFIED = "referee.verified"
    REFEREE_REJECTED = "referee.rejected"
    DEFENDER_PROPOSED = "defender.proposed"
    APPROVAL_REQUESTED = "approval.requested"
    APPROVAL_GRANTED = "approval.granted"
    DEFENDER_APPLIED = "defender.applied"


class Status(str, Enum):
    CLAIMED = "claimed"
    VERIFIED = "verified"
    REJECTED = "rejected"
    PENDING = "pending"
    APPLIED = "applied"


class NodeKind(str, Enum):
    PROJECT = "project"
    SERVICE_ACCOUNT = "serviceAccount"
    KEY = "key"
    BUCKET = "bucket"
    FIREWALL = "firewall"
    INSTANCE = "instance"
    ROLE = "role"


class Relation(str, Enum):
    HAS_KEY = "hasKey"
    LEAKS_KEY = "leaksKey"
    TOKEN_CREATOR = "tokenCreator"
    ACT_AS = "actAs"
    HAS_ROLE = "hasRole"
    ALLOWS_INGRESS = "allowsIngress"
    READS_BUCKET = "readsBucket"
    WRITES_BUCKET = "writesBucket"


@dataclass
class Node:
    id: str
    kind: NodeKind
    name: str
    reachable: bool = False
    fromMisconfig: Optional[str] = None
    labels: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind.value,
            "name": self.name,
            "reachable": self.reachable,
            "fromMisconfig": self.fromMisconfig,
            "labels": self.labels,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Node":
        return cls(
            id=d["id"],
            kind=NodeKind(d["kind"]),
            name=d["name"],
            reachable=d.get("reachable", False),
            fromMisconfig=d.get("fromMisconfig"),
            labels=d.get("labels", {}),
        )


@dataclass
class Edge:
    id: str
    from_: str  # 'from' in the JSON contract; renamed to avoid the Python keyword
    to: str
    relation: Relation
    viaMisconfig: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "from": self.from_,
            "to": self.to,
            "relation": self.relation.value,
            "viaMisconfig": self.viaMisconfig,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Edge":
        return cls(
            id=d["id"],
            from_=d["from"],
            to=d["to"],
            relation=Relation(d["relation"]),
            viaMisconfig=d.get("viaMisconfig"),
        )


@dataclass
class Path:
    id: str
    edges: list[str]
    startNode: str
    targetNode: str
    misconfigs: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "edges": self.edges,
            "startNode": self.startNode,
            "targetNode": self.targetNode,
            "misconfigs": self.misconfigs,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Path":
        return cls(
            id=d["id"],
            edges=list(d["edges"]),
            startNode=d["startNode"],
            targetNode=d["targetNode"],
            misconfigs=list(d["misconfigs"]),
        )


@dataclass
class Graph:
    """The single graph/current document."""

    round: int
    score: int
    nodes: list[Node]
    edges: list[Edge]

    def to_dict(self) -> dict[str, Any]:
        # updatedAt is set to serverTimestamp() by firestore_io on write.
        return {
            "round": self.round,
            "score": self.score,
            "nodes": [n.to_dict() for n in self.nodes],
            "edges": [e.to_dict() for e in self.edges],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Graph":
        return cls(
            round=d["round"],
            score=d["score"],
            nodes=[Node.from_dict(n) for n in d.get("nodes", [])],
            edges=[Edge.from_dict(e) for e in d.get("edges", [])],
        )
