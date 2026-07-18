#!/usr/bin/env bash
# Generate secrets/htpasswd for production nginx basic auth.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="${AUTH_USER:-admin}"
PASS="${1:-}"

if [[ -z "$PASS" ]]; then
  echo "Usage: $0 '<strong-password>'"
  echo "Optional: AUTH_USER=ops $0 '<password>'"
  exit 1
fi

mkdir -p "$ROOT/secrets"

if command -v htpasswd >/dev/null 2>&1; then
  htpasswd -nbB "$USER_NAME" "$PASS" > "$ROOT/secrets/htpasswd"
elif command -v openssl >/dev/null 2>&1; then
  HASH="$(openssl passwd -apr1 "$PASS")"
  echo "${USER_NAME}:${HASH}" > "$ROOT/secrets/htpasswd"
else
  # Fallback via docker httpd image
  docker run --rm httpd:2.4-alpine htpasswd -nbB "$USER_NAME" "$PASS" > "$ROOT/secrets/htpasswd"
fi

chmod 644 "$ROOT/secrets/htpasswd"
echo "Wrote $ROOT/secrets/htpasswd (user=$USER_NAME)"
