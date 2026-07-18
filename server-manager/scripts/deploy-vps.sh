#!/usr/bin/env bash
# Deploy Server Manager to the VPS for always-on watchdog + private UI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEPLOY_HOST:-46.224.210.19}"
USER="${DEPLOY_USER:-root}"
KEY="${DEPLOY_KEY:-$ROOT/../azaf-codes.pem}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/server-manager}"

if [[ ! -f "$KEY" ]]; then
  echo "SSH key not found: $KEY"
  exit 1
fi

if [[ ! -f "$ROOT/.env" ]]; then
  echo "Missing $ROOT/.env — copy from .env.example and fill secrets first."
  exit 1
fi

if [[ ! -f "$ROOT/secrets/htpasswd" ]]; then
  echo "Missing secrets/htpasswd — run: ./scripts/gen-htpasswd.sh '<password>'"
  exit 1
fi

mkdir -p "$ROOT/secrets"
cp "$KEY" "$ROOT/secrets/ssh_key"
chmod 600 "$ROOT/secrets/ssh_key"

echo "> Syncing to ${USER}@${HOST}:${REMOTE_DIR}"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "${USER}@${HOST}" "mkdir -p '$REMOTE_DIR/secrets'"

rsync -az --delete \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  --exclude node_modules \
  --exclude .next \
  --exclude docker/nginx/certs \
  --exclude '.env.local' \
  --exclude '.git' \
  "$ROOT/" "${USER}@${HOST}:${REMOTE_DIR}/"

# Ensure VPS .env SSHes to the Docker host (not the app container)
ssh -i "$KEY" "${USER}@${HOST}" "cd '$REMOTE_DIR' && \
  if ! grep -q '^SSH_HOST=' .env; then echo 'SSH_HOST=host.docker.internal' >> .env; fi && \
  sed -i 's/^SSH_HOST=.*/SSH_HOST=host.docker.internal/' .env && \
  sed -i 's|^SSH_PRIVATE_KEY_PATH=.*|SSH_PRIVATE_KEY_PATH=/run/secrets/ssh_key|' .env && \
  chmod 600 secrets/ssh_key .env && \
  chmod 644 secrets/htpasswd && \
  if ! command -v aws >/dev/null 2>&1; then
    echo '> Installing AWS CLI (for R2 uploads)...'
    if command -v pip3 >/dev/null 2>&1; then
      pip3 install --break-system-packages -q awscli || pip3 install -q awscli || true
    fi
    if ! command -v aws >/dev/null 2>&1; then
      curl -fsSL 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip' -o /tmp/awscliv2.zip && \
      apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unzip && \
      unzip -qo /tmp/awscliv2.zip -d /tmp && /tmp/aws/install -u && rm -rf /tmp/aws /tmp/awscliv2.zip || true
    fi
  fi
  docker compose -f docker-compose.prod.yml up -d --build"

echo "> Deployed."
echo "  On VPS:  http://127.0.0.1:3847  (basic auth)"
echo "  Tunnel:  ssh -i $KEY -L 3847:127.0.0.1:3847 ${USER}@${HOST}"
echo "  Then open http://127.0.0.1:3847 locally"
echo "  Or set up Tailscale Serve (see docs/DEPLOY.md)"
