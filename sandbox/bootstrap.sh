#!/usr/bin/env bash
# Creates the throwaway sandbox project. Run once, before `terraform apply`.
#
#   PROJECT_ID=breach-range-1031 BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX ./sandbox/bootstrap.sh
#
# Optional: ORG_ID (create the project under an org; needed for the MC-05 deny policy),
#           BUDGET_AMOUNT (default 50, in the billing account's currency).
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"
: "${BILLING_ACCOUNT:?set BILLING_ACCOUNT}"
BUDGET_AMOUNT="${BUDGET_AMOUNT:-50}"
REGION="us-central1"

# Pin every gcloud call (and its API quota) to the sandbox, never the user's default project.
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
export CLOUDSDK_BILLING_QUOTA_PROJECT="$PROJECT_ID"

if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Project $PROJECT_ID already exists, skipping create."
else
  gcloud projects create "$PROJECT_ID" ${ORG_ID:+--organization="$ORG_ID"} \
    --labels=purpose=hackathon-sandbox,teardown=after-event
fi

# The billing APIs don't need billing enabled, and the link and budget calls bill quota to this project.
gcloud services enable --project="$PROJECT_ID" \
  cloudbilling.googleapis.com \
  billingbudgets.googleapis.com

gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"

gcloud services enable --project="$PROJECT_ID" \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com \
  compute.googleapis.com \
  storage.googleapis.com \
  firestore.googleapis.com \
  networkmanagement.googleapis.com \
  policytroubleshooter.googleapis.com \
  aiplatform.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  billingbudgets.googleapis.com \
  orgpolicy.googleapis.com

gcloud billing budgets create \
  --billing-account="$BILLING_ACCOUNT" \
  --display-name="breach-range sandbox ($PROJECT_ID)" \
  --budget-amount="$BUDGET_AMOUNT" \
  --filter-projects="projects/$PROJECT_ID" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0

if ! gcloud firestore databases describe --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud firestore databases create --project="$PROJECT_ID" \
    --location="$REGION" --type=firestore-native
fi

STATE_BUCKET="gs://${PROJECT_ID}-tfstate"
if ! gcloud storage buckets describe "$STATE_BUCKET" >/dev/null 2>&1; then
  gcloud storage buckets create "$STATE_BUCKET" --project="$PROJECT_ID" \
    --location="$REGION" --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets update "$STATE_BUCKET" --versioning
fi

echo
echo "Sandbox ready: $PROJECT_ID"
echo "Terraform state bucket: $STATE_BUCKET"
if [[ -z "${ORG_ID:-}" ]]; then
  echo "No ORG_ID given: IAM deny policies (MC-05) need an org. Use the conditional-binding decoy instead."
fi
