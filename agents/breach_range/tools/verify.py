"""The Referee's independent re-reads. This is the honesty mechanism.

The Referee never trusts the Attacker's claim. For each edge the Attacker chained,
a function here goes back to ground truth and re-derives whether the edge really holds:

  - leaksKey  -> is the bucket still public AND does it still expose a file naming
                 that service account? (live storage re-read)
  - tokenCreator -> can the source SA actually mint tokens for the target SA?
                 Asked via IAM Policy Troubleshooter, which evaluates allow *and*
                 deny policies. This is what rejects the MC-05 decoy: Recon's plain
                 getIamPolicy sees the allow binding, but the Troubleshooter sees the
                 deny that blocks the final step, so the Referee rejects what the
                 Attacker claimed.
  - allowsIngress -> Connectivity Tests, wired for the network misconfigs (MC-03/04)
                 that arrive in step 6.

Every function returns (ok, detail). detail is a short human-readable line that the
Referee copies into the event log, so the audit trail records *why*, not just the verdict.
"""

from __future__ import annotations

import json
from typing import Optional

from breach_range.shared.config import PROJECT_ID
from breach_range.tools import gcp_readonly

# Policy Troubleshooter access states (google.cloud.policytroubleshooter.v1.AccessState).
_GRANTED = "GRANTED"

TOKEN_CREATOR_PERMISSION = "iam.serviceAccounts.getAccessToken"


# --- leaksKey: a public bucket exposes a file naming a service account ----

def verify_leaks_key(bucket_name: str, sa_email: str) -> tuple[bool, str]:
    """Confirm, live, that `bucket_name` is public and exposes a key file whose
    client_email is `sa_email`. Re-reads storage; trusts nothing the Attacker said."""
    if not gcp_readonly.bucket_is_public(bucket_name):
        return False, f"{bucket_name} is not publicly readable"
    for obj in gcp_readonly.list_bucket_objects(bucket_name):
        try:
            client_email = json.loads(gcp_readonly.read_object(bucket_name, obj)).get(
                "client_email"
            )
        except Exception:
            continue
        if client_email == sa_email:
            return True, f"public object {obj} exposes credentials for {sa_email}"
    return False, f"{bucket_name} is public but exposes no key naming {sa_email}"


# --- tokenCreator: source SA can impersonate target SA --------------------

def verify_token_creator(source_sa: str, target_sa: str) -> tuple[bool, str]:
    """Ask Policy Troubleshooter whether `source_sa` may mint access tokens for
    `target_sa`. GRANTED only if the allow binding survives any deny policy."""
    body = {
        "accessTuple": {
            "principal": source_sa,
            "fullResourceName": (
                f"//iam.googleapis.com/projects/{PROJECT_ID}"
                f"/serviceAccounts/{target_sa}"
            ),
            "permission": TOKEN_CREATOR_PERMISSION,
        }
    }
    resp = (
        gcp_readonly._svc("policytroubleshooter", "v1")
        .iam()
        .troubleshoot(body=body)
        .execute()
    )
    access = resp.get("access", "ACCESS_STATE_UNSPECIFIED")
    if access == _GRANTED:
        return True, f"{source_sa} may mint tokens for {target_sa} (Troubleshooter: GRANTED)"
    return False, f"token creation on {target_sa} not granted to {source_sa} ({access})"


# --- allowsIngress: network reachability (MC-03/MC-04, exercised from step 6) ---

def connectivity_test(
    test_id: str,
    source: dict,
    destination: dict,
    protocol: str = "TCP",
) -> tuple[bool, str]:
    """Run a Connectivity Test and report whether the destination is REACHABLE.

    Creates the test, waits for the operation, reads the reachability result, and
    deletes the test so re-runs don't collide. source/destination follow the
    networkmanagement Endpoint shape (ipAddress/port, instance, network, etc.).
    """
    svc = gcp_readonly._svc("networkmanagement", "v1")
    parent = f"projects/{PROJECT_ID}/locations/global"
    body = {"protocol": protocol, "source": source, "destination": destination}
    op = (
        svc.projects()
        .locations()
        .global_()
        .connectivityTests()
        .create(parent=parent, testId=test_id, body=body)
        .execute()
    )
    _wait_operation(svc, op["name"])
    name = f"{parent}/connectivityTests/{test_id}"
    try:
        test = (
            svc.projects().locations().global_().connectivityTests().get(name=name).execute()
        )
        result = (test.get("reachabilityDetails") or {}).get("result", "UNKNOWN")
        return result == "REACHABLE", f"connectivity to destination is {result}"
    finally:
        svc.projects().locations().global_().connectivityTests().delete(
            name=name
        ).execute()


def verify_ingress(labels: dict, destination: Optional[dict]) -> tuple[bool, str]:
    """Verify a firewall-ingress edge via Connectivity Tests.

    Needs a concrete destination (instance IP + port) that Recon reads onto the
    firewall/instance node when MC-03/MC-04 are seeded. Until those labels exist we
    cannot honestly verify the path, so we do not claim it reachable."""
    cidr = (labels or {}).get("cidr")
    port = (labels or {}).get("port")
    if not destination or not cidr or port is None:
        return False, "no destination/port to run a connectivity test against"
    source = {"ipAddress": cidr.split("/", 1)[0]}
    dest = {**destination, "port": int(port)}
    return connectivity_test(f"referee-ingress-{port}", source, dest)


def _wait_operation(svc, op_name: str, tries: int = 60) -> None:
    import time

    for _ in range(tries):
        op = svc.projects().locations().global_().operations().get(name=op_name).execute()
        if op.get("done"):
            return
        time.sleep(1)
    raise TimeoutError(f"connectivity test operation did not finish: {op_name}")
