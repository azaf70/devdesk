#!/usr/bin/env bash
# Scaffold and validate a Laravel app for private GHCR + Coolify deployment.
#
# Safe default: changes local app files and Server Manager queue configuration.
# Coolify is only changed when --apply-coolify is explicitly supplied.
#
# Security notes:
# - Never bakes secrets into images (.dockerignore + APP_KEY gate).
# - Coolify API/webhook calls require HTTPS.
# - Deploy webhooks use a Bearer token secret (never put tokens in the URL).
# - Generated entrypoint refuses missing APP_KEY or APP_DEBUG=true.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_MANAGER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_ROOT=""
LARAVEL_DIR="."
IMAGE=""
PROJECT=""
DISPLAY_NAME=""
PORT="3000"
TAG="latest"
COOLIFY_UUID=""
COOLIFY_URL="${COOLIFY_URL:-}"
COOLIFY_TOKEN="${COOLIFY_API_TOKEN:-}"
COOLIFY_DEPLOY_WEBHOOK=""
APPLY_COOLIFY=0
DEPLOY=0
FORCE=0
CHECK_ONLY=0
UPDATE_MONITORING=1

usage() {
  cat <<'EOF'
Usage:
  ./scripts/setup-laravel-ghcr.sh \
    --app /path/to/repo \
    --image ghcr.io/OWNER/REPO \
    --project COOLIFY_PROJECT_NAME \
    [options]

Required:
  --app PATH              Git repository/build-context root
  --image IMAGE           GHCR image without tag (ghcr.io/owner/repo)
  --project NAME          Coolify projectName label used by monitoring

Options:
  --name DISPLAY_NAME     Server Manager display name (default: project)
  --port PORT             Container/Coolify exposed port (default: 3000)
  --tag TAG               Image tag used by Coolify (default: latest)
  --laravel-dir PATH      Laravel path relative to app root (default: .)
  --force                 Replace generated Docker/GHCR files
  --check                 Validate only; do not write local files
  --no-monitoring         Do not update Server Manager QUEUE_APPS

Optional Coolify API configuration (existing application):
  --coolify-uuid UUID     Existing Coolify application UUID
  --apply-coolify         PATCH app + QUEUE_CONNECTION=database
  --deploy                Trigger deployment after API configuration
  --coolify-url URL       Must be https://… (default: $COOLIFY_URL)
  --coolify-token TOKEN   Default: $COOLIFY_API_TOKEN
  --deploy-webhook URL    Coolify deploy URL (uuid only; never embed tokens).
                          Saves GitHub secrets COOLIFY_DEPLOY_WEBHOOK +
                          COOLIFY_API_TOKEN (token from --coolify-token / env).

Examples:
  ./scripts/setup-laravel-ghcr.sh \
    --app ../my-app --image ghcr.io/azaf70/my-app \
    --project my-app --name "My App"

  COOLIFY_URL=https://coolify.example.com \
  COOLIFY_API_TOKEN=... \
  ./scripts/setup-laravel-ghcr.sh \
    --app ../my-app --image ghcr.io/azaf70/my-app \
    --project my-app --coolify-uuid abc123 \
    --apply-coolify --deploy
EOF
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

warn() {
  echo "WARN: $*" >&2
}

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"
}

require_https_url() {
  local label="$1"
  local url="$2"
  [[ "$url" == https://* ]] || die "$label must use HTTPS"
  [[ "$url" != *[[:space:]]* ]] || die "$label must not contain whitespace"
  [[ "$url" != *"@"* ]] || die "$label must not embed credentials (user:pass@…)"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APP_ROOT="${2:-}"; shift 2 ;;
    --image) IMAGE="${2:-}"; shift 2 ;;
    --project) PROJECT="${2:-}"; shift 2 ;;
    --name) DISPLAY_NAME="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --tag) TAG="${2:-}"; shift 2 ;;
    --laravel-dir) LARAVEL_DIR="${2:-}"; shift 2 ;;
    --coolify-uuid) COOLIFY_UUID="${2:-}"; shift 2 ;;
    --coolify-url) COOLIFY_URL="${2:-}"; shift 2 ;;
    --coolify-token) COOLIFY_TOKEN="${2:-}"; shift 2 ;;
    --deploy-webhook) COOLIFY_DEPLOY_WEBHOOK="${2:-}"; shift 2 ;;
    --apply-coolify) APPLY_COOLIFY=1; shift ;;
    --deploy) DEPLOY=1; shift ;;
    --force) FORCE=1; shift ;;
    --check) CHECK_ONLY=1; shift ;;
    --no-monitoring) UPDATE_MONITORING=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (use --help)" ;;
  esac
done

[[ -n "$APP_ROOT" ]] || die "--app is required"
[[ -n "$IMAGE" ]] || die "--image is required"
[[ -n "$PROJECT" ]] || die "--project is required"
[[ "$IMAGE" =~ ^ghcr\.io/[a-z0-9._-]+/[a-z0-9._-]+$ ]] ||
  die "--image must look like ghcr.io/owner/repo (lowercase, without tag)"
[[ "$PORT" =~ ^[0-9]+$ ]] || die "--port must be numeric"
(( PORT >= 1 && PORT <= 65535 )) || die "--port must be between 1 and 65535"
[[ "$TAG" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || die "--tag is not a valid Docker tag"
[[ "$PROJECT" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || die "--project contains unsupported characters"
[[ "$DISPLAY_NAME" != *:* && "$DISPLAY_NAME" != *,* ]] ||
  die "--name cannot contain ':' or ','"
[[ "$LARAVEL_DIR" != /* && "$LARAVEL_DIR" != *".."* && "$LARAVEL_DIR" != *[[:space:]]* ]] ||
  die "--laravel-dir must be a safe relative path without spaces"
[[ "$DEPLOY" -eq 0 || "$APPLY_COOLIFY" -eq 1 ]] || die "--deploy requires --apply-coolify"
[[ "$CHECK_ONLY" -eq 0 || -z "$COOLIFY_DEPLOY_WEBHOOK" ]] ||
  die "--check cannot be combined with --deploy-webhook"
[[ -z "$COOLIFY_UUID" || "$COOLIFY_UUID" =~ ^[a-zA-Z0-9_-]{8,64}$ ]] ||
  die "--coolify-uuid looks invalid"

if [[ -n "$COOLIFY_DEPLOY_WEBHOOK" ]]; then
  require_https_url "--deploy-webhook" "$COOLIFY_DEPLOY_WEBHOOK"
  [[ "$COOLIFY_DEPLOY_WEBHOOK" != *token=* && "$COOLIFY_DEPLOY_WEBHOOK" != *Bearer* ]] ||
    die "--deploy-webhook must not embed API tokens; use COOLIFY_API_TOKEN instead"
fi

if [[ -n "$COOLIFY_URL" ]]; then
  require_https_url "COOLIFY_URL/--coolify-url" "$COOLIFY_URL"
fi

APP_ROOT="$(cd "$APP_ROOT" 2>/dev/null && pwd)" || die "App path does not exist"
LARAVEL_ROOT="$APP_ROOT/$LARAVEL_DIR"
DISPLAY_NAME="${DISPLAY_NAME:-$PROJECT}"

[[ -f "$LARAVEL_ROOT/artisan" ]] || die "Missing Laravel artisan: $LARAVEL_ROOT/artisan"
[[ -f "$LARAVEL_ROOT/composer.json" ]] || die "Missing composer.json: $LARAVEL_ROOT/composer.json"
[[ -f "$LARAVEL_ROOT/composer.lock" ]] || die "Missing composer.lock: $LARAVEL_ROOT/composer.lock"
[[ -f "$LARAVEL_ROOT/package.json" ]] || die "Missing package.json: $LARAVEL_ROOT/package.json"
[[ -f "$LARAVEL_ROOT/package-lock.json" ]] || die "Missing package-lock.json (this template uses npm ci)"

relative_prefix() {
  if [[ "$LARAVEL_DIR" == "." ]]; then
    printf ''
  else
    printf '%s/' "${LARAVEL_DIR%/}"
  fi
}

PREFIX="$(relative_prefix)"
COPY_SOURCE="${LARAVEL_DIR%/}"

write_generated() {
  local path="$1"
  local mode="${2:-0644}"
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp"

  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    rm -f "$tmp"
    return
  fi

  if [[ -e "$path" && "$FORCE" -ne 1 ]]; then
    echo "KEEP  $path"
    rm -f "$tmp"
    return
  fi

  mkdir -p "$(dirname "$path")"
  mv "$tmp" "$path"
  chmod "$mode" "$path"
  echo "WRITE $path"
}

upsert_env_example() {
  local file="$1"
  local key="$2"
  local value="$3"
  [[ -f "$file" ]] || return 0
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s/^${key}=.*/${key}=${value}/" "$file"
    rm -f "${file}.bak"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

if [[ "$CHECK_ONLY" -eq 0 ]]; then
  write_generated "$APP_ROOT/Dockerfile.prod" <<EOF
# Production image for Coolify / private GHCR.
# Generated by server-manager/scripts/setup-laravel-ghcr.sh.
# Composer runs before Vite because Ziggy may be imported from vendor.
# Do NOT bake secrets — Coolify injects env at runtime.

FROM composer:2 AS vendor
WORKDIR /app
COPY ${PREFIX}composer.json ${PREFIX}composer.lock ./
RUN composer install \\
  --no-dev --no-interaction --no-progress --prefer-dist \\
  --optimize-autoloader --no-scripts

FROM node:22-alpine AS frontend
WORKDIR /app
COPY ${PREFIX}package.json ${PREFIX}package-lock.json ./
RUN npm ci
COPY $COPY_SOURCE ./
COPY --from=vendor /app/vendor ./vendor
# Drop build tooling from the layer before the runtime stage copies assets.
RUN npm run build && rm -rf node_modules vendor

FROM php:8.3-fpm-alpine AS runtime
RUN apk add --no-cache \\
      nginx supervisor bash \\
      icu-dev libzip-dev oniguruma-dev \\
    && docker-php-ext-install -j"\$(nproc)" \\
      pdo_mysql intl mbstring zip bcmath opcache \\
    && rm -rf /var/cache/apk/*

WORKDIR /var/www/html
COPY --from=vendor /app/vendor ./vendor
COPY $COPY_SOURCE ./
COPY --from=frontend /app/public/build ./public/build

# Never ship local package discovery; it may reference require-dev providers.
RUN rm -f bootstrap/cache/packages.php bootstrap/cache/services.php \\
  && mkdir -p storage/framework/cache storage/framework/sessions \\
       storage/framework/views storage/logs bootstrap/cache \\
  && touch storage/logs/laravel.log \\
  && chown -R www-data:www-data storage bootstrap/cache \\
  && chmod -R ug+rwx storage bootstrap/cache

COPY docker/prod/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/prod/supervisord.conf /etc/supervisord.conf
COPY docker/prod/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \\
  && sed -i 's|^listen = .*|listen = 127.0.0.1:9000|' /usr/local/etc/php-fpm.d/www.conf \\
  && sed -i 's|^;clear_env = no|clear_env = no|' /usr/local/etc/php-fpm.d/www.conf || true

ENV PORT=$PORT
EXPOSE $PORT
ENTRYPOINT ["entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
EOF

  write_generated "$APP_ROOT/docker/prod/nginx.conf" <<EOF
server {
    listen $PORT default_server;
    listen [::]:$PORT default_server;
    server_name _;
    root /var/www/html/public;
    index index.php;

    client_max_body_size 32M;
    server_tokens off;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    location / {
        try_files \$uri \$uri/ /index.php?\$query_string;
    }

    location ~ \\.php\$ {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME \$realpath_root\$fastcgi_script_name;
        fastcgi_param DOCUMENT_ROOT \$realpath_root;
        fastcgi_pass 127.0.0.1:9000;
        fastcgi_read_timeout 120s;
        fastcgi_hide_header X-Powered-By;
    }

    location ~* \\.(?:css|js|jpg|jpeg|gif|png|svg|ico|woff2?)\$ {
        expires 7d;
        access_log off;
        try_files \$uri =404;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }
}
EOF

  write_generated "$APP_ROOT/docker/prod/supervisord.conf" <<'EOF'
[supervisord]
nodaemon=true
user=root
logfile=/dev/null
pidfile=/tmp/supervisord.pid

[program:php-fpm]
command=/usr/local/sbin/php-fpm -F
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:nginx]
command=/usr/sbin/nginx -g "daemon off;"
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

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

  write_generated "$APP_ROOT/docker/prod/entrypoint.sh" 0755 <<'EOF'
#!/bin/sh
set -e
cd /var/www/html

# Alpine /bin/sh does not support brace expansion.
mkdir -p storage/framework/cache storage/framework/sessions \
  storage/framework/views storage/logs bootstrap/cache
touch storage/logs/laravel.log
chown -R www-data:www-data storage bootstrap/cache 2>/dev/null || true

if [ -z "${APP_KEY:-}" ] || [ "$APP_KEY" = "base64:" ]; then
  echo "APP_KEY is missing; refusing to start" >&2
  exit 1
fi

case "${APP_DEBUG:-false}" in
  true|TRUE|1|yes|YES|on|ON)
    echo "APP_DEBUG must be false in this production image; refusing to start" >&2
    exit 1
    ;;
esac

if [ "${APP_ENV:-production}" = "local" ] || [ "${APP_ENV:-production}" = "testing" ]; then
  echo "APP_ENV=${APP_ENV} is not allowed in this production image; refusing to start" >&2
  exit 1
fi

php artisan storage:link --force 2>/dev/null || php artisan storage:link 2>/dev/null || true
php artisan config:cache 2>/dev/null || true
php artisan route:cache 2>/dev/null || true
php artisan view:cache 2>/dev/null || true
chown -R www-data:www-data storage bootstrap/cache 2>/dev/null || true

exec "$@"
EOF

  write_generated "$APP_ROOT/.github/workflows/ghcr.yml" <<EOF
name: Build and push GHCR image

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ghcr-\${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read
  packages: write

env:
  IMAGE: $IMAGE

jobs:
  build:
    name: Build & push
    runs-on: ubuntu-latest
    env:
      COOLIFY_DEPLOY_WEBHOOK: \${{ secrets.COOLIFY_DEPLOY_WEBHOOK }}
      COOLIFY_API_TOKEN: \${{ secrets.COOLIFY_API_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: \${{ env.IMAGE }}
          tags: |
            type=sha,prefix=
            type=raw,value=latest,enable={{is_default_branch}}
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile.prod
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Trigger Coolify deployment
        if: \${{ env.COOLIFY_DEPLOY_WEBHOOK != '' && env.COOLIFY_API_TOKEN != '' }}
        run: |
          curl --fail --silent --show-error --retry 3 --max-time 30 \\
            -H "Authorization: Bearer \${COOLIFY_API_TOKEN}" \\
            -H "Accept: application/json" \\
            "\$COOLIFY_DEPLOY_WEBHOOK"
EOF

  touch "$APP_ROOT/.dockerignore"
  for pattern in \
    ".git" ".github" "node_modules" "vendor" "public/build" "public/hot" \
    "bootstrap/cache/*.php" "storage/logs/*" \
    "storage/framework/cache/*" "storage/framework/sessions/*" \
    "storage/framework/views/*" "storage/pail" "storage/app/*" "!storage/app/.gitignore" \
    "tests" "e2e" "playwright-report" "test-results" ".phpunit.cache" \
    ".env" ".env.*" "!.env.example" "auth.json" "secrets" "secrets/**" \
    "*.pem" "*.key" "*.p12" "*.pfx" "id_rsa" "id_rsa.*" ".aws" ".aws/**" \
    ".cursor" ".vscode" ".idea" "docker-compose*.yml" "*.md"; do
    grep -Fxq "$pattern" "$APP_ROOT/.dockerignore" ||
      echo "$pattern" >> "$APP_ROOT/.dockerignore"
  done

  if [[ -f "$LARAVEL_ROOT/.env.example" ]]; then
    upsert_env_example "$LARAVEL_ROOT/.env.example" QUEUE_CONNECTION database
    upsert_env_example "$LARAVEL_ROOT/.env.example" APP_ENV production
    upsert_env_example "$LARAVEL_ROOT/.env.example" APP_DEBUG false
    upsert_env_example "$LARAVEL_ROOT/.env.example" SESSION_SECURE_COOKIE true
    upsert_env_example "$LARAVEL_ROOT/.env.example" LOG_LEVEL error
  else
    warn "No .env.example found; set APP_ENV=production APP_DEBUG=false QUEUE_CONNECTION=database in Coolify"
  fi

  if [[ -f "$APP_ROOT/docker/prod/supervisord.conf" ]] &&
     ! grep -q '^\[program:queue-worker\]' "$APP_ROOT/docker/prod/supervisord.conf"; then
    "$SCRIPT_DIR/add-queue-worker.sh" "$APP_ROOT"
  fi
fi

update_queue_apps() {
  local env_file="$1"
  local entry="$PROJECT:coolify.projectName=$PROJECT:$DISPLAY_NAME"
  [[ -f "$env_file" ]] || return 0
  python3 - "$env_file" "$entry" "$PROJECT" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
entry = sys.argv[2]
project = sys.argv[3]
lines = path.read_text().splitlines()
key = "QUEUE_APPS="
found = False

for i, line in enumerate(lines):
    if not line.startswith(key):
        continue
    found = True
    raw = line[len(key):].strip()
    quote = '"' if raw.startswith('"') and raw.endswith('"') else ""
    if quote:
        raw = raw[1:-1]
    entries = [item for item in raw.split(",") if item]
    entries = [item for item in entries if not item.startswith(project + ":")]
    entries.append(entry)
    lines[i] = key + quote + ",".join(entries) + quote
    break

if not found:
    lines.extend(["", f'{key}"{entry}"'])

path.write_text("\n".join(lines) + "\n")
PY
  echo "UPDATE $env_file (QUEUE_APPS)"
}

if [[ "$CHECK_ONLY" -eq 0 && "$UPDATE_MONITORING" -eq 1 ]]; then
  update_queue_apps "$SERVER_MANAGER_ROOT/.env"
  update_queue_apps "$SERVER_MANAGER_ROOT/.env.example"
fi

validate() {
  local failed=0
  local conf="$APP_ROOT/docker/prod/supervisord.conf"
  local entry="$APP_ROOT/docker/prod/entrypoint.sh"

  for file in \
    "$APP_ROOT/Dockerfile.prod" \
    "$APP_ROOT/docker/prod/nginx.conf" \
    "$conf" \
    "$entry" \
    "$APP_ROOT/.github/workflows/ghcr.yml"; do
    if [[ ! -f "$file" ]]; then
      echo "FAIL  missing $file"
      failed=1
    else
      echo "OK    $file"
    fi
  done

  grep -q '^\[program:queue-worker\]' "$conf" 2>/dev/null ||
    { echo "FAIL  queue worker missing from $conf"; failed=1; }
  grep -q "listen $PORT" "$APP_ROOT/docker/prod/nginx.conf" 2>/dev/null ||
    { echo "FAIL  nginx does not listen on $PORT"; failed=1; }
  grep -q "EXPOSE $PORT" "$APP_ROOT/Dockerfile.prod" 2>/dev/null ||
    { echo "FAIL  Dockerfile does not expose $PORT"; failed=1; }
  grep -q 'packages: write' "$APP_ROOT/.github/workflows/ghcr.yml" 2>/dev/null ||
    { echo "FAIL  GHCR workflow lacks packages: write"; failed=1; }
  grep -q 'APP_DEBUG must be false' "$entry" 2>/dev/null ||
    { echo "FAIL  entrypoint lacks APP_DEBUG refusal (rerun with --force)"; failed=1; }
  grep -q 'APP_KEY is missing' "$entry" 2>/dev/null ||
    { echo "FAIL  entrypoint lacks APP_KEY gate (rerun with --force)"; failed=1; }
  grep -q '\.env' "$APP_ROOT/.dockerignore" 2>/dev/null ||
    { echo "FAIL  .dockerignore does not exclude .env"; failed=1; }
  if [[ -n "$COOLIFY_DEPLOY_WEBHOOK" ]] &&
     ! grep -q 'secrets.COOLIFY_API_TOKEN' \
       "$APP_ROOT/.github/workflows/ghcr.yml" 2>/dev/null; then
    echo "FAIL  workflow missing COOLIFY_API_TOKEN Bearer deploy (rerun with --force)"
    failed=1
  fi
  grep -q '^QUEUE_CONNECTION=database' "$LARAVEL_ROOT/.env.example" 2>/dev/null ||
    warn ".env.example does not set QUEUE_CONNECTION=database"
  grep -q '^APP_DEBUG=false' "$LARAVEL_ROOT/.env.example" 2>/dev/null ||
    warn ".env.example does not set APP_DEBUG=false"
  grep -q "env('QUEUE_CONNECTION', 'database')" "$LARAVEL_ROOT/config/queue.php" 2>/dev/null ||
    warn "config/queue.php does not visibly default QUEUE_CONNECTION to database"

  if ! grep -RqsE "create_.*jobs_table|Schema::create\\(['\"]jobs['\"]" "$LARAVEL_ROOT/database/migrations"; then
    warn "No jobs-table migration detected; run: php artisan queue:table && php artisan migrate"
  fi

  return "$failed"
}

echo
echo "Validating generated setup..."
validate || die "Validation failed"

if [[ -n "$COOLIFY_DEPLOY_WEBHOOK" ]]; then
  command -v gh >/dev/null || die "--deploy-webhook requires the GitHub CLI (gh)"
  [[ -n "$COOLIFY_TOKEN" ]] ||
    die "--deploy-webhook also needs COOLIFY_API_TOKEN / --coolify-token (Bearer auth)"
  (
    cd "$APP_ROOT"
    printf '%s' "$COOLIFY_DEPLOY_WEBHOOK" | gh secret set COOLIFY_DEPLOY_WEBHOOK
    printf '%s' "$COOLIFY_TOKEN" | gh secret set COOLIFY_API_TOKEN
  )
  echo "UPDATE GitHub secrets COOLIFY_DEPLOY_WEBHOOK + COOLIFY_API_TOKEN"
fi

coolify_request() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local args=(
    -fsS -X "$method"
    --max-time 30
    -H "Authorization: Bearer $COOLIFY_TOKEN"
    -H "Accept: application/json"
    -H "Content-Type: application/json"
  )
  [[ -z "$data" ]] || args+=(-d "$data")
  curl "${args[@]}" "${COOLIFY_URL%/}/api/v1$path"
}

if [[ "$APPLY_COOLIFY" -eq 1 ]]; then
  [[ -n "$COOLIFY_UUID" ]] || die "--apply-coolify requires --coolify-uuid"
  [[ -n "$COOLIFY_URL" ]] || die "Set --coolify-url or COOLIFY_URL"
  [[ -n "$COOLIFY_TOKEN" ]] || die "Set --coolify-token or COOLIFY_API_TOKEN"
  require_https_url "COOLIFY_URL/--coolify-url" "$COOLIFY_URL"
  command -v curl >/dev/null || die "curl is required for Coolify API calls"

  IMAGE_JSON="$(json_escape "$IMAGE")"
  TAG_JSON="$(json_escape "$TAG")"
  PORT_JSON="$(json_escape "$PORT")"

  echo "Configuring Coolify application $COOLIFY_UUID..."
  coolify_request PATCH "/applications/$COOLIFY_UUID" \
    "{\"build_pack\":\"dockerimage\",\"docker_registry_image_name\":${IMAGE_JSON},\"docker_registry_image_tag\":${TAG_JSON},\"ports_exposes\":${PORT_JSON}}"
  echo
  coolify_request PATCH "/applications/$COOLIFY_UUID/envs/bulk" \
    '{"data":[
      {"key":"QUEUE_CONNECTION","value":"database","is_preview":false,"is_literal":true},
      {"key":"APP_ENV","value":"production","is_preview":false,"is_literal":true},
      {"key":"APP_DEBUG","value":"false","is_preview":false,"is_literal":true},
      {"key":"LOG_LEVEL","value":"error","is_preview":false,"is_literal":true}
    ]}'
  echo

  if [[ "$DEPLOY" -eq 1 ]]; then
    echo "Triggering Coolify deployment..."
    coolify_request GET "/deploy?uuid=$COOLIFY_UUID"
    echo
  fi
fi

cat <<EOF

Ready: $DISPLAY_NAME
  Image:      $IMAGE:$TAG
  Port:       $PORT
  Monitoring: coolify.projectName=$PROJECT

Security checklist before go-live:
  - Coolify env: APP_ENV=production, APP_DEBUG=false, APP_KEY set, HTTPS domain
  - GHCR package visibility = private
  - Persistent mounts reviewed (/app/... → /var/www/html/... if needed)
  - Never put Coolify API tokens inside deploy webhook URLs

Next:
  1. Review and commit the generated app files.
  2. Push main; GitHub Actions will build and push :latest + :<sha>.
  3. Configure Coolify via the UI, or rerun with --apply-coolify.
  4. Optional auto-deploy: --deploy-webhook URL + COOLIFY_API_TOKEN.
  5. Deploy, run php artisan migrate --force once, and verify HTTP + queue.
EOF
