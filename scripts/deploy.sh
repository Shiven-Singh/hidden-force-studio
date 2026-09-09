#!/usr/bin/env bash
# Build the image on Cloud Build, then roll it onto the existing Cloud Run service.
# `gcloud run deploy --source` tends to hang on a Mac after the build finishes, so this
# does the two halves separately. Every other service setting (CPU, memory, instances,
# env vars, the Parallel secret) stays as it is.
# Usage: scripts/deploy.sh [project] [region] [service]
set -euo pipefail
PROJECT="${1:-hidden-force-studios}"
REGION="${2:-us-central1}"
SERVICE="${3:-hidden-force-studio}"
TAG="$(git rev-parse --short HEAD)-$(date -u +%H%M%S)"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/$SERVICE:$TAG"

echo "building $IMAGE"
BUILD_ID="$(gcloud builds submit --project "$PROJECT" --tag "$IMAGE" --async --format='value(id)' .)"
echo "build $BUILD_ID submitted, waiting"
while :; do
  STATUS="$(gcloud builds describe "$BUILD_ID" --project "$PROJECT" --format='value(status)')"
  case "$STATUS" in
    SUCCESS) break ;;
    FAILURE|CANCELLED|TIMEOUT|EXPIRED|INTERNAL_ERROR)
      echo "build $STATUS"
      gcloud builds log "$BUILD_ID" --project "$PROJECT" | tail -40
      exit 1 ;;
    *) printf '.'; sleep 15 ;;
  esac
done
echo
echo "deploying"
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --image "$IMAGE" --quiet
URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')"
echo "live: $URL"
curl -s -o /dev/null -w 'front page %{http_code}\n' "$URL/"
curl -s -o /dev/null -w 'film seek  %{http_code} (206 means seeking works)\n' -H 'Range: bytes=0-99' "$URL/api/runs/zayan_20260907T201737/files/animatic/animatic.mp4"
