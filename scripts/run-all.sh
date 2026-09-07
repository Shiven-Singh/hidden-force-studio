#!/usr/bin/env bash
# Run every bible through a running hfs-api, one at a time, so the preview
# model's rate limit is never hit. Usage: scripts/run-all.sh [api base] [bible ...]
set -uo pipefail
BASE="${1:-http://localhost:8080}"; shift || true
BIBLES=("$@")
[ ${#BIBLES[@]} -eq 0 ] && BIBLES=(bibles/*.json)
for b in "${BIBLES[@]}"; do
  echo "=================================================================="
  echo "$(date -u +%H:%M:%SZ)  $b"
  node scripts/run-bible.mjs "$b" "$BASE" || echo "FAILED: $b"
done
echo "=================================================================="
echo "$(date -u +%H:%M:%SZ)  batch complete"
