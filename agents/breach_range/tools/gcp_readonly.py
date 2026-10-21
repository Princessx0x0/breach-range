"""Read-only GCP reads for Recon and Referee. No method here mutates anything.

Uses the discovery API with application-default credentials (or the agent's own service
account when deployed). Recon reads inventory; Referee re-reads the same ground truth plus
Policy Troubleshooter and Connectivity Tests (added in tools/verify.py for step 3).
"""

from __future__ import annotations

import functools
from typing import Any

import googleapiclient.discovery
from google.api_core.client_options import ClientOptions

from breach_range.shared.config import PROJECT_ID


@functools.lru_cache(maxsize=None)
def _svc(name: str, version: str):
    # cache_discovery=False avoids noisy file-cache warnings under WSL.
    # Pin the quota/billing project to the sandbox. Otherwise these calls bill
    # ADC's quota_project_id (a developer's default project), where niche APIs
    # like Policy Troubleshooter are disabled -> 403 SERVICE_DISABLED. The agent
    # SAs set this correctly in production; this keeps local runs honest too.
    return googleapiclient.discovery.build(
        name, version, cache_discovery=False,
        client_options=ClientOptions(quota_project_id=PROJECT_ID),
    )


# --- IAM: service accounts, their keys, and per-SA policies --------------

def list_service_accounts() -> list[dict[str, Any]]:
    svc = _svc("iam", "v1")
    resp = svc.projects().serviceAccounts().list(
        name=f"projects/{PROJECT_ID}"
    ).execute()
    return resp.get("accounts", [])


def list_sa_keys(sa_email: str) -> list[dict[str, Any]]:
    """User-managed keys on a service account, with their disabled state."""
    svc = _svc("iam", "v1")
    resp = svc.projects().serviceAccounts().keys().list(
        name=f"projects/{PROJECT_ID}/serviceAccounts/{sa_email}",
        keyTypes="USER_MANAGED",
    ).execute()
    return resp.get("keys", [])


def get_sa_iam_policy(sa_email: str) -> dict[str, Any]:
    """IAM policy ON a service account resource (who can impersonate / create tokens).

    Reads at policy version 3 so conditional bindings are returned rather than dropped.
    The MC-05 decoy's tokenCreator grant carries an always-false condition: Recon must
    see the binding (so the Attacker claims the path) even though the Referee's Policy
    Troubleshooter will later find the condition blocks it."""
    svc = _svc("iam", "v1")
    return svc.projects().serviceAccounts().getIamPolicy(
        resource=f"projects/{PROJECT_ID}/serviceAccounts/{sa_email}",
        options_requestedPolicyVersion=3,
    ).execute()


# --- Project-level IAM ---------------------------------------------------

def get_project_iam_policy() -> dict[str, Any]:
    svc = _svc("cloudresourcemanager", "v3")
    return svc.projects().getIamPolicy(
        resource=f"projects/{PROJECT_ID}",
        body={"options": {"requestedPolicyVersion": 3}},
    ).execute()


def roles_for_member(member: str) -> list[str]:
    """All project-level roles granted to a member, e.g. a serviceAccount:... string."""
    policy = get_project_iam_policy()
    return [b["role"] for b in policy.get("bindings", []) if member in b.get("members", [])]


# --- Storage -------------------------------------------------------------

def list_buckets() -> list[dict[str, Any]]:
    svc = _svc("storage", "v1")
    resp = svc.buckets().list(project=PROJECT_ID).execute()
    return resp.get("items", [])


def get_bucket_iam_policy(bucket: str) -> dict[str, Any]:
    svc = _svc("storage", "v1")
    return svc.buckets().getIamPolicy(bucket=bucket).execute()


def bucket_is_public(bucket: str) -> bool:
    policy = get_bucket_iam_policy(bucket)
    for b in policy.get("bindings", []):
        members = set(b.get("members", []))
        if "allUsers" in members or "allAuthenticatedUsers" in members:
            return True
    return False


def list_bucket_objects(bucket: str) -> list[str]:
    svc = _svc("storage", "v1")
    resp = svc.objects().list(bucket=bucket).execute()
    return [o["name"] for o in resp.get("items", [])]


def read_object(bucket: str, obj: str) -> str:
    """Download an object's bytes as text. Read-only; used to re-read the leaked
    key file the MC-01 bucket exposes. The object never holds real key material."""
    svc = _svc("storage", "v1")
    return svc.objects().get_media(bucket=bucket, object=obj).execute().decode("utf-8")


# --- Compute (for MC-03 / MC-04, used from step 6) -----------------------

def list_firewalls() -> list[dict[str, Any]]:
    svc = _svc("compute", "v1")
    resp = svc.firewalls().list(project=PROJECT_ID).execute()
    return resp.get("items", [])


def list_instances() -> list[dict[str, Any]]:
    svc = _svc("compute", "v1")
    resp = svc.instances().aggregatedList(project=PROJECT_ID).execute()
    out: list[dict[str, Any]] = []
    for _zone, scoped in resp.get("items", {}).items():
        out.extend(scoped.get("instances", []))
    return out
