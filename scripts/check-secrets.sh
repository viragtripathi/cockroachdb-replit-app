#!/usr/bin/env bash
set -euo pipefail

pattern='postgres(ql)?://[^[:space:]]+:[^[:space:]@]+@|BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|Bearer [A-Za-z0-9_-]{16,}'

if rg -n --hidden \
  --glob '!.git/**' \
  --glob '!node_modules/**' \
  --glob '!dist/**' \
  --glob '!package-lock.json' \
  --regexp "$pattern" .; then
  echo "Potential credential material found. Remove it before committing."
  exit 1
fi

echo "Secret-pattern check passed."
