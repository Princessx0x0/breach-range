#!/usr/bin/env bash
# Org-level changes the range needs, scoped as tightly as possible:
#   - project-level exceptions (sandbox only) to two org policies that block MC-01
#   - roles/iam.denyAdmin on the org for the operator, needed to attach the MC-05 deny policy
#
#   PROJECT_ID=breach-range-1031 ORG_ID=167325235444 OPERATOR=user:you@example.com ./sandbox/org-exceptions.sh
#   ... ./sandbox/org-exceptions.sh --undo    # after the event
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"
: "${ORG_ID:?set ORG_ID}"
: "${OPERATOR:?set OPERATOR, e.g. user:you@example.com}"

export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
export CLOUDSDK_BILLING_QUOTA_PROJECT="$PROJECT_ID"

CONSTRAINTS=(iam.disableServiceAccountKeyCreation iam.allowedPolicyMemberDomains)

if [[ "${1:-}" == "--undo" ]]; then
  for c in "${CONSTRAINTS[@]}"; do
    gcloud org-policies delete "$c" --project="$PROJECT_ID" || true
  done
  gcloud organizations remove-iam-policy-binding "$ORG_ID" \
    --member="$OPERATOR" --role=roles/iam.denyAdmin --condition=None
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# MC-01 needs a service-account key to exist on the CI SA (it is disabled straight after).
cat > "$tmp/keys.yaml" <<EOF
name: projects/$PROJECT_ID/policies/iam.disableServiceAccountKeyCreation
spec:
  rules:
  - enforce: false
EOF

# MC-01 needs allUsers on one bucket; the org otherwise allows only its own domain.
cat > "$tmp/domains.yaml" <<EOF
name: projects/$PROJECT_ID/policies/iam.allowedPolicyMemberDomains
spec:
  rules:
  - allowAll: true
EOF

gcloud org-policies set-policy "$tmp/keys.yaml"
gcloud org-policies set-policy "$tmp/domains.yaml"

gcloud organizations add-iam-policy-binding "$ORG_ID" \
  --member="$OPERATOR" --role=roles/iam.denyAdmin --condition=None \
  --format="value(etag)" >/dev/null

echo "Exceptions set on $PROJECT_ID; $OPERATOR has roles/iam.denyAdmin on org $ORG_ID."
echo "Undo after the event with: $0 --undo"
