#!/usr/bin/env bash
# Deletes the sandbox project after the event. Irreversible after the 30-day recovery window.
#
#   PROJECT_ID=breach-range-1031 ./sandbox/teardown.sh
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"

read -r -p "Delete project $PROJECT_ID and everything in it? Type the project id to confirm: " answer
if [[ "$answer" != "$PROJECT_ID" ]]; then
  echo "Aborted."
  exit 1
fi

if [[ -n "${ORG_ID:-}" && -n "${OPERATOR:-}" ]]; then
  # The project-level exceptions go with the project, but the denyAdmin grant lives on the org.
  "$(dirname "$0")/org-exceptions.sh" --undo
else
  echo "ORG_ID/OPERATOR not set: remember to run org-exceptions.sh --undo to drop roles/iam.denyAdmin."
fi

gcloud projects delete "$PROJECT_ID" --quiet
echo "Deleted $PROJECT_ID. The billing budget stays on the billing account; remove it in the console if you want."
