#!/usr/bin/env bash
# One-time Google Cloud setup for Hidden Force Studio.
# Usage: scripts/gcp-setup.sh <project-id> <billing-account-id>
# Find the billing account id with: gcloud billing accounts list
set -euo pipefail

PROJECT_ID="${1:?project id, e.g. hidden-force-studio-2026}"
BILLING="${2:?billing account id, e.g. 0X0X0X-0X0X0X-0X0X0X}"
REGION="${REGION:-us-central1}"

echo "== account: $(gcloud config get-value account 2>/dev/null)"
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "== project $PROJECT_ID exists"
else
  gcloud projects create "$PROJECT_ID" --name="Hidden Force Studio"
fi
gcloud config set project "$PROJECT_ID"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING"

gcloud services enable \
  aiplatform.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  artifactregistry.googleapis.com

BUCKET="gs://${PROJECT_ID}-outputs"
if gcloud storage buckets describe "$BUCKET" >/dev/null 2>&1; then
  echo "== bucket $BUCKET exists"
else
  gcloud storage buckets create "$BUCKET" --location="$REGION" --uniform-bucket-level-access
fi

if [ -f .env ]; then
  python3 - "$PROJECT_ID" "${BUCKET#gs://}" "$REGION" <<'PY'
import pathlib, re, sys
project, bucket, region = sys.argv[1:4]
p = pathlib.Path(".env"); s = p.read_text()
s = re.sub(r"^GOOGLE_CLOUD_PROJECT=.*$", f"GOOGLE_CLOUD_PROJECT={project}", s, flags=re.M)
s = re.sub(r"^GOOGLE_CLOUD_LOCATION=.*$", f"GOOGLE_CLOUD_LOCATION={region}", s, flags=re.M)
s = re.sub(r"^OUTPUT_BUCKET=.*$", f"OUTPUT_BUCKET={bucket}", s, flags=re.M)
p.write_text(s)
print("== .env updated: project, location, bucket")
PY
fi

echo
echo "== next: application default credentials (opens a browser)"
echo "   gcloud auth application-default login"
echo "   gcloud auth application-default set-quota-project $PROJECT_ID"
echo "== then: pnpm --filter hfs-api smoke"
