# Server Manager

Local Docker app at **https://server-manager.apps.test** — live SSH, watchdog, backups, queues, and Docker control for your VPS.

**Agents:** start with [INVENTORY.md](INVENTORY.md) (status, R2, Coolify MCP, **cost budget**). Deploy: [docs/DEPLOY.md](docs/DEPLOY.md). Queues: [docs/QUEUES.md](docs/QUEUES.md). New Laravel app queues: [docs/ADD_LARAVEL_QUEUES.md](docs/ADD_LARAVEL_QUEUES.md). Stay free-tier / a couple of USD max — no surprise bills.

## Setup

1. Ensure `local-dev-network` exists (`cd ../docker-core && docker compose up -d`).
2. Ensure [`azaf-codes.pem`](../azaf-codes.pem) exists in the workspace root, then:

```bash
cp .env.example .env
```

3. Fill Phase 2 settings in `.env` (many are already set in the real gitignored `.env`):

- `WATCHDOG_URLS` — comma-separated public HTTPS URLs
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — alerts
- `BACKUP_TARGETS` — e.g. `postgres:coolify-db:coolify` (**still must be set**)
- `BACKUP_S3_*` — Cloudflare R2 off-box upload (bucket **already provisioned**; keys live in `.env`)

4. Add DNS:

```bash
sudo sh -c 'echo "127.0.0.1 server-manager.apps.test" >> /etc/hosts'
```

5. Start (stop other apps binding 80/443 if needed):

```bash
docker stop kinventory-web
docker compose up -d --build
```

6. Open https://server-manager.apps.test — also see **Playbooks** and keep [INVENTORY.md](INVENTORY.md) updated.

## Phase 2 features

| Feature | Where |
|---------|--------|
| URL + host watchdog | Home → Watchdog; runs in background from `server.ts` |
| Telegram on state change | Needs `TELEGRAM_*` |
| Laravel queues | Home → Queues; `QUEUE_APPS` + [docs/QUEUES.md](docs/QUEUES.md) |
| Backup now | Home → Backups → on-VPS dump + optional R2 (`UPLOADED_S3`) |
| Restore drill | [docs/RESTORE_DRILL.md](docs/RESTORE_DRILL.md) |
| Incident playbooks | `/playbooks` |
| Phase 3 (Coolify/Hetzner/MCP) | Deferred — [docs/PHASE3.md](docs/PHASE3.md) |

## Cloudflare R2 (backups)

| | |
|--|--|
| Bucket | `server-manager-backups` |
| Account | `b18eee30d3f2e5e888b4aa0869d831ad` |
| Endpoint | `https://b18eee30d3f2e5e888b4aa0869d831ad.r2.cloudflarestorage.com` |
| Object prefix | `server-manager/<stamp>/` |
| Config | `BACKUP_S3_*` in `.env` (needs `aws` CLI on the VPS — deploy installs it) |

Full handoff + rotate steps: [INVENTORY.md](INVENTORY.md) and [docs/DEPLOY.md](docs/DEPLOY.md).

## Notes

- SSH uses the PEM key mounted at `/run/secrets/azaf-codes.pem` (local) or `secrets/ssh_key` (VPS). Never commit the key or `.env`.
- Only one project nginx can bind host ports 80/443 at a time (local compose).
- **Always-on / secure deploy:** [docs/DEPLOY.md](docs/DEPLOY.md) (VPS + basic auth + Tailscale/SSH tunnel + R2).
