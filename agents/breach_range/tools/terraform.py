"""The write tool. Defender only, and gated by a human approval that is checked here
in code, never in a prompt.

The governance invariant: `defender.applied` is written only after an `approval.granted`
event exists for the same target. `apply()` enforces it: it looks the approval up in the
event log and refuses otherwise, so no prompt wording can talk the system into applying an
unapproved change. The approval check and the audit write live together with the effect,
so you cannot change the sandbox without both a prior approval and a logged record.

A remediation is deliberately minimal: cutting one offending binding. Removing exactly the
Terraform resource that creates the misconfig closes the path without over-restricting a
legitimate flow -- the fix-minimality the Referee scores.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path as _Path
from typing import Callable, Optional

from breach_range.shared.schema import Action, Agent, Path, Status
from breach_range.tools import firestore_io

# repo root is four levels up from this file: tools/ -> breach_range/ -> agents/ -> root.
SANDBOX_DIR = _Path(__file__).resolve().parents[3] / "sandbox"


class ApprovalRequired(RuntimeError):
    """Raised when apply() is called without a matching approval.granted event."""


@dataclass(frozen=True)
class Remediation:
    """How to close one seeded misconfig: the Terraform resource to remove, plus the
    diff and one-liner the dashboard shows."""

    misconfig: str
    target: str  # terraform resource address, destroyed to close the edge
    title: str
    summary: str
    diff: str


# Keyed by misconfig id -- the same ground-truth anchor Recon tags nodes with. Addresses
# are module.seed.* because sandbox/main.tf wires the seed as a module.
REMEDIATIONS: dict[str, Remediation] = {
    "MC-01": Remediation(
        misconfig="MC-01",
        target="module.seed.google_storage_bucket_iam_member.assets_public_allusers",
        title="Remove public access from the asset bucket",
        summary="the asset bucket is no longer world-readable",
        diff=(
            "--- a/sandbox/seed/misconfigs.tf\n"
            "+++ b/sandbox/seed/misconfigs.tf\n"
            "@@ MC-01: close the public bucket @@\n"
            "-# The misconfiguration: the bucket is world-readable.\n"
            '-resource "google_storage_bucket_iam_member" "assets_public_allusers" {\n'
            "-  bucket = google_storage_bucket.assets_public.name\n"
            '-  role   = "roles/storage.objectViewer"\n'
            '-  member = "allUsers"\n'
            "-}\n"
        ),
    ),
    "MC-02": Remediation(
        misconfig="MC-02",
        target="module.seed.google_service_account_iam_member.ci_can_impersonate_owner",
        title="Revoke tokenCreator from the CI service account",
        summary="ci-deployer can no longer impersonate org-admin",
        diff=(
            "--- a/sandbox/seed/misconfigs.tf\n"
            "+++ b/sandbox/seed/misconfigs.tf\n"
            "@@ MC-02: revoke the impersonation edge @@\n"
            "-# MC-02: ci-deployer can mint tokens for org-admin. This is the escalation edge.\n"
            '-resource "google_service_account_iam_member" "ci_can_impersonate_owner" {\n'
            "-  service_account_id = google_service_account.org_admin.name\n"
            '-  role               = "roles/iam.serviceAccountTokenCreator"\n'
            '-  member             = "serviceAccount:${google_service_account.ci_deployer.email}"\n'
            "-}\n"
        ),
    ),
}


@dataclass(frozen=True)
class Patch:
    """A proposed change for one claimed path: which misconfig it cuts and how."""

    path_id: str
    remediation: Remediation

    @property
    def target_event(self) -> str:
        return f"path:{self.path_id}"


def build_patch(path: Path) -> Patch:
    """The minimal fix for a path: cut its entry misconfig. Breaking the first edge
    denies the outsider the whole chain, so one binding closes every path through it.
    Falls back to the first misconfig on the path we actually know how to remediate."""
    for mc in path.misconfigs:
        if mc in REMEDIATIONS:
            return Patch(path_id=path.id, remediation=REMEDIATIONS[mc])
    raise ValueError(f"no known remediation for path {path.id} ({path.misconfigs})")


def apply(
    round: int,
    patch: Patch,
    approval_lookup: Callable[[Action, str], Optional[dict]] = firestore_io.find_event,
    runner: Optional[Callable[[str], None]] = None,
    log: Callable[..., str] = firestore_io.append_event,
) -> None:
    """Apply a patch -- but only if a human already approved it. Checks the event log
    for an approval.granted on this path, runs the targeted Terraform destroy, and logs
    defender.applied. Refuses with ApprovalRequired if no approval exists, before any
    change is made. (The injectable params let tests drive the gate without GCP.)"""
    target = patch.target_event
    if approval_lookup(Action.APPROVAL_GRANTED, target) is None:
        raise ApprovalRequired(
            f"refusing to apply {patch.remediation.misconfig}: no approval.granted for {target}"
        )
    (runner or _terraform_destroy)(patch.remediation.target)
    log(
        round=round,
        agent=Agent.DEFENDER,
        action=Action.DEFENDER_APPLIED,
        target=target,
        status=Status.APPLIED,
        payload={
            "diff": patch.remediation.diff,
            "targets": [patch.remediation.target],
            "pathId": patch.path_id,
            "misconfig": patch.remediation.misconfig,
        },
        result=f"applied: {patch.remediation.summary}",
    )


def _terraform_destroy(address: str) -> None:
    """Remove exactly one resource from the live sandbox. Vars come from
    sandbox/terraform.tfvars; runs as the Defender's narrow-write service account."""
    subprocess.run(
        [
            "terraform",
            f"-chdir={SANDBOX_DIR}",
            "destroy",
            "-auto-approve",
            "-input=false",
            "-no-color",
            "-target",
            address,
        ],
        check=True,
    )
