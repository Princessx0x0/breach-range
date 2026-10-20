"""Offline tests for the Defender's pure logic and the approval gate.

Patch selection and path ranking touch nothing external. The gate in
tools/terraform.apply is tested with injected lookups/runner, so the headline
governance invariant -- no apply without a prior approval.granted -- is proven without
a sandbox or any mock GCP data. The real Terraform destroy runs against the live
sandbox at demo time.
"""

import pytest

from breach_range.defender.agent import choose_path
from breach_range.shared.schema import Action, Path
from breach_range.tools import terraform


def _path(pid, misconfigs, edges=("e1",)):
    return Path(id=pid, edges=list(edges), startNode="a", targetNode="b",
                misconfigs=list(misconfigs))


def test_build_patch_cuts_the_entry_misconfig():
    # entry misconfig is first on the path; cutting it collapses the whole chain.
    patch = terraform.build_patch(_path("p1", ["MC-01", "MC-02"], ["e1", "e2"]))
    assert patch.remediation.misconfig == "MC-01"
    assert patch.remediation.target.endswith("assets_public_allusers")
    assert patch.path_id == "p1"


def test_build_patch_falls_back_to_a_known_remediation():
    # no remediation for MC-99, so it drops to the next misconfig it can actually fix.
    patch = terraform.build_patch(_path("p1", ["MC-99", "MC-02"]))
    assert patch.remediation.misconfig == "MC-02"


def test_build_patch_raises_when_nothing_is_remediable():
    with pytest.raises(ValueError):
        terraform.build_patch(_path("p1", ["MC-99"]))


def test_choose_highest_impact_path():
    small = _path("p1", ["MC-01"], ["e1"])
    big = _path("p2", ["MC-01", "MC-02"], ["e1", "e2"])
    assert choose_path([small, big]).id == "p2"


def test_apply_refused_without_approval():
    patch = terraform.build_patch(_path("p1", ["MC-01"]))
    calls = []
    with pytest.raises(terraform.ApprovalRequired):
        terraform.apply(
            round=1,
            patch=patch,
            approval_lookup=lambda action, target: None,  # no approval on record
            runner=lambda addr: calls.append(addr),
            log=lambda **kw: calls.append("logged"),
        )
    assert calls == []  # nothing destroyed, nothing logged


def test_apply_runs_and_logs_when_approved():
    patch = terraform.build_patch(_path("p1", ["MC-01"]))
    destroyed, logged = [], []

    def lookup(action, target):
        assert action == Action.APPROVAL_GRANTED
        assert target == "path:p1"
        return {"action": action.value, "target": target}

    terraform.apply(
        round=2,
        patch=patch,
        approval_lookup=lookup,
        runner=lambda addr: destroyed.append(addr),
        log=lambda **kw: logged.append(kw) or "evt-id",
    )
    assert destroyed == [patch.remediation.target]
    assert logged[0]["action"] == Action.DEFENDER_APPLIED
    assert logged[0]["target"] == "path:p1"
