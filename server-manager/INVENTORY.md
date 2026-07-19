# Inventory

Source of truth for humans and next agents. Never put real passwords, API tokens, or secret keys here — only *where* they live and non-secret facts.

## Cost budget (hard constraint)

**Target: $0 extra beyond the existing Hetzner VPS. Absolute ceiling: a couple of USD/month total for new/cloud add-ons.** Prefer free tiers; never enable paid Cloudflare products, SaaS monitoring, or extra Hetzner volumes/snapshots without asking.

| Provider / piece | Cost posture | Notes |
|------------------|--------------|--------|
| Hetzner VPS (`ubuntu-4gb-nbg1-3`) | Already paying (main bill) | Do **not** add servers, volumes, or frequent snapshots |
| Coolify (self-hosted) | Free | API enabled for read-only Cursor MCP; no Coolify Cloud |
| Server Manager | Free (self-hosted) | |
| Telegram bot | Free | |
| Cloudflare R2 | Stay in **free tier** | 10 GB storage, 1M Class A, 10M Class B/mo; egress $0. Use Standard storage only. Keep retention low (`BACKUP_KEEP_DAYS=7`) |
| Cloudflare Workers / paid add-ons | **Do not enable** | Not needed for backups |
| Cursor Coolify MCP (`coolify-mcp-server-kof70`) | Free (npx) | `COOLIFY_READONLY=true` |
| Hetzner API / Coolify write automation | Deferred (Phase 3) | Avoid anything that spins paid resources |

Agents: if a feature needs a paid plan or will grow R2 past ~few GB, stop and propose a free alternative first.

## Agent status (as of 2026-07-19)

| Item | Status |
|------|--------|
| Local Server Manager | Works at `https://server-manager.apps.test` |
| VPS always-on deploy | `/opt/server-manager`, UI `127.0.0.1:3847` + nginx basic auth |
| Watchdog + Telegram | Configured in `.env` |
| Laravel queue monitor | Home → Queues; `QUEUE_APPS` + Telegram via watchdog ([`docs/QUEUES.md`](docs/QUEUES.md)) |
| Cloudflare R2 bucket | `server-manager-backups` (WEUR, Standard) |
| R2 S3 API token | `server-manager-backups-r2` — keys in `.env` as `BACKUP_S3_*` |
| `BACKUP_TARGETS` | Set (Coolify Postgres + 3 MySQL DBs) |
| Off-box upload verified | **Yes** — `UPLOADED_S3` (2026-07-18) |
| Dump auth | Uses container `$POSTGRES_USER` / `$MYSQL_ROOT_PASSWORD` ([`lib/backup.ts`](lib/backup.ts)) |
| Coolify API | **Enabled** on instance (`instance_settings.is_api_enabled`) |
| Coolify MCP (Cursor, read-only) | Configured in `~/.cursor/mcp.json`; token in `secrets/coolify-api-token.txt` |
| Tailscale Serve | Optional; SSH tunnel works |
| Phase 3 (Coolify/Hetzner **in Server Manager**) | Deferred — [docs/PHASE3.md](docs/PHASE3.md) |

### Next agent checklist

1. **Human (Coolify, off-peak):** cut each Laravel app to GHCR + `QUEUE_CONNECTION=database` per [docs/QUEUES.md](docs/QUEUES.md) (KInventory first).
2. Optional: restore drill ([docs/RESTORE_DRILL.md](docs/RESTORE_DRILL.md)).
3. Optional: Tailscale Serve.
4. Watch R2 usage in Cloudflare dashboard — stay under free tier.
5. Rotate Telegram bot token if it was ever pasted in a screenshot.
6. Do **not** add paid Cloudflare/Hetzner features without explicit approval.

## Host

| Field | Value |
|-------|--------|
| Provider | Hetzner Cloud |
| Hostname | `ubuntu-4gb-nbg1-3` |
| Public IP | `46.224.210.19` |
| Region | NBG1 (Nuremberg) |
| SSH user | `root` |
| SSH key (local) | [`../azaf-codes.pem`](../azaf-codes.pem) — never commit |
| Coolify | `https://coolify.azafcodes.co.uk/` |
| Server Manager (local) | `https://server-manager.apps.test` |
| Server Manager (VPS) | `http://127.0.0.1:3847` via SSH tunnel or Tailscale — **not** public |
| VPS install path | `/opt/server-manager` |
| Prod bind | `127.0.0.1:3847` only (`docker-compose.prod.yml`) |
| Basic auth user | `admin` (password in local `secrets/ui-password.txt`, not committed) |

## Cloudflare / R2

| Field | Value |
|-------|--------|
| Account ID | `b18eee30d3f2e5e888b4aa0869d831ad` |
| Bucket | `server-manager-backups` |
| Location hint | WEUR |
| Storage class | **Standard** (free tier applies; do not use Infrequent Access) |
| S3 endpoint | `https://b18eee30d3f2e5e888b4aa0869d831ad.r2.cloudflarestorage.com` |
| Region (SDK / aws CLI) | `auto` |
| Object prefix | `server-manager/<stamp>/` |
| API token name | `server-manager-backups-r2` |
| Credentials | `BACKUP_S3_*` in `server-manager/.env` only |
| Other buckets on account | `who-owes-who` (unrelated app) |
| Retention | `BACKUP_KEEP_DAYS=7` (on-VPS prune + keep uploads small) |

To rotate R2 keys: Cloudflare dashboard → R2 → Manage API Tokens → revoke `server-manager-backups-r2` → create Object Read & Write scoped to `server-manager-backups` → update `.env` → redeploy.

## Coolify MCP (Cursor only)

| Field | Value |
|-------|--------|
| Package | `coolify-mcp-server-kof70` via `npx -y` |
| Mode | **Read-only** (`COOLIFY_READONLY=true`) |
| Base URL | `https://coolify.azafcodes.co.uk` |
| Token file | `server-manager/secrets/coolify-api-token.txt` (gitignored) |
| Also in | `~/.cursor/mcp.json` → `mcpServers.coolify` |
| Example (no secrets) | [`.cursor/mcp.json.example`](.cursor/mcp.json.example) |
| Token name in Coolify | `cursor-mcp-readonly` (ability: `read`) |

This is **not** Phase 3. Phase 3 = Coolify/Hetzner controls inside Server Manager UI.

## Secrets locations (paths only)

| Secret | Where it lives |
|--------|----------------|
| SSH private key | Workspace root `azaf-codes.pem` + Docker mount `/run/secrets/azaf-codes.pem` (local) or `secrets/ssh_key` (VPS) |
| Server Manager env | `server-manager/.env` (gitignored) |
| Telegram bot token | `TELEGRAM_BOT_TOKEN` in `.env` |
| Telegram chat ID | `TELEGRAM_CHAT_ID` in `.env` |
| R2 S3 keys | `BACKUP_S3_*` in `.env` |
| UI basic auth password | `secrets/ui-password.txt` + `secrets/htpasswd` (htpasswd must be world-readable to nginx → `644`) |
| Coolify API token (read) | `secrets/coolify-api-token.txt` + `~/.cursor/mcp.json` |
| Hetzner API token | _(Phase 3 — not used yet)_ |
| Laravel queue apps | Non-secret: `QUEUE_APPS` / `QUEUE_FAILED_ALERT` in `.env` — [docs/QUEUES.md](docs/QUEUES.md) |

## Apps / services

| App / service | Public domain | Notes |
|---------------|---------------|--------|
| Coolify | `coolify.azafcodes.co.uk` | Control plane; DB `coolify-db` / db `coolify` |
| Personal site | `azafcodes.co.uk` | |
| Kinventory | `kinventory.azafcodes.co.uk` | MySQL db `kinventory`; queues via GHCR worker — [docs/QUEUES.md](docs/QUEUES.md) |
| Who Owes Who | `who-owes-who.azafcodes.co.uk` | MySQL db `who_owes_who`; own R2 bucket; queue recipe [docs/ADD_LARAVEL_QUEUES.md](docs/ADD_LARAVEL_QUEUES.md) |
| Rent tracker | _(Coolify app)_ | MySQL db `rent_tracker`; queues via GHCR worker |
| Shared MySQL | — | Container `fustqja2jtg6lwbiil1hm6ho` |
| Coolify Redis | — | `coolify-redis` |
| Coolify proxy / Traefik | — | `coolify-proxy` |

## Watchdog targets

Configured via `WATCHDOG_URLS` in `.env` (keep in sync):

| URL | Notes |
|-----|--------|
| `https://coolify.azafcodes.co.uk/` | Control plane |
| `https://azafcodes.co.uk/` | |
| `https://kinventory.azafcodes.co.uk/` | |
| `https://who-owes-who.azafcodes.co.uk/` | |

## Backup targets

Format: `engine:container:dbname[:user]` (comma-separated). Postgres defaults to container `$POSTGRES_USER`; MySQL uses root + `$MYSQL_ROOT_PASSWORD`.

| Target | Engine | Container | DB name | Off-box? |
|--------|--------|-----------|---------|----------|
| Coolify DB | postgres | `coolify-db` | `coolify` | R2 ✅ |
| Kinventory | mysql | `fustqja2jtg6lwbiil1hm6ho` | `kinventory` | R2 ✅ |
| Rent tracker | mysql | `fustqja2jtg6lwbiil1hm6ho` | `rent_tracker` | R2 ✅ |
| Who Owes Who | mysql | `fustqja2jtg6lwbiil1hm6ho` | `who_owes_who` | R2 ✅ |

On-VPS dumps: `/root/server-manager-backups`. Upload marker: `UPLOADED_S3`.

## Notes

- Deploy brain = Coolify on the VPS. Ops brain = Server Manager (local for tinkering; VPS for always-on watchdog).
- From Docker on the VPS, host Docker/SSH target is `SSH_HOST=host.docker.internal` (deploy sets this).
- Cloudflare MCP (`user-cloudflare`) was used for R2; Coolify MCP is separate and read-only.
- Phase 3 stays deferred until Phase 2 is stable ~1 week. See [docs/PHASE3.md](docs/PHASE3.md).
