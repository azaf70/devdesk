#!/usr/bin/env bash
# Low-level helper: add a Laravel queue-worker to an existing production config.
# Usage: ./scripts/add-queue-worker.sh /path/to/laravel-app
# For a new app, prefer setup-laravel-ghcr.sh (Docker, GHCR, monitoring, Coolify).
# Idempotent. Does not touch Coolify.

set -euo pipefail

ROOT="${1:-}"
if [[ -z "$ROOT" || ! -d "$ROOT" ]]; then
  echo "Usage: $0 /path/to/laravel-app" >&2
  exit 1
fi

CONF="$ROOT/docker/prod/supervisord.conf"
if [[ ! -f "$CONF" ]]; then
  echo "Missing $CONF — create docker/prod + Dockerfile.prod first (copy from kinventory)." >&2
  exit 1
fi

if grep -q '^\[program:queue-worker\]' "$CONF"; then
  echo "Already present: [program:queue-worker] in $CONF"
  exit 0
fi

cat >> "$CONF" <<'EOF'

[program:queue-worker]
command=php /var/www/html/artisan queue:work database --sleep=3 --tries=3 --max-time=3600
autostart=true
autorestart=true
stopwaitsecs=3600
user=www-data
numprocs=1
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
EOF

echo "Appended [program:queue-worker] to $CONF"
echo "Next: commit, push (GHCR build), Coolify QUEUE_CONNECTION=database + image cutover."
echo "For full setup: scripts/setup-laravel-ghcr.sh --help"
