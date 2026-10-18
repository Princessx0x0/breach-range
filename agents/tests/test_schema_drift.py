"""Fail fast if schema.py drifts from firestore-schema.json (the contract)."""

import json
from pathlib import Path

from breach_range.shared import schema

SCHEMA_JSON = Path(__file__).resolve().parents[2] / "firestore-schema.json"


def _contract() -> dict:
    return json.loads(SCHEMA_JSON.read_text())["enums"]


def test_schema_json_exists():
    assert SCHEMA_JSON.exists(), f"missing contract at {SCHEMA_JSON}"


def test_enums_match_contract():
    enums = _contract()
    pairs = [
        (schema.Agent, "Agent"),
        (schema.Action, "Action"),
        (schema.Status, "Status"),
        (schema.NodeKind, "NodeKind"),
        (schema.Relation, "Relation"),
    ]
    for enum_cls, key in pairs:
        py_values = {m.value for m in enum_cls}
        json_values = set(enums[key])
        assert py_values == json_values, (
            f"{key} drift: only in py={py_values - json_values}, "
            f"only in json={json_values - py_values}"
        )
