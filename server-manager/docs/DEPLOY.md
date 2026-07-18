# Deploy Server Manager (always-on, private, basic auth)

Goal: Watchdog + Telegram keep running when your laptop is off. UI is **not** on the public internet.

For current inventory (R2 bucket, domains, what’s left), see [../INVENTORY.md](../INVENTORY.md).

## Architecture

```text
Your Mac ──Tailscale or SSH tunnel──→ VPS :3847 (nginx + basic auth)
                                         └── Server Manager app
                                              ├── Watchdog → Telegram
                                              ├── SSH → host.docker.internal (Coolify/Docker)
                                              └── Backups → Cloudflare R2 (server-manager-backups)
```

## 1. Fill `.env` (on your Mac, then deploy copies it)

Required:

- `SSH_*` / PEM (deploy sets `SSH_HOST=host.docker.internal` on the VPS)
- `WATCHDOG_URLS=...` (already filled for azafcodes apps — see inventory)
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`
- `BACKUP_TARGETS=postgres:container:dbname` — **still required**; empty until you set it

### Cloudflare R2 (provisioned)

Already created on account `b18eee30d3f2e5e888b4aa0869d831ad`:

| | |
|--|--|
| Bucket | `server-manager-backups` (WEUR) |
| Token name | `server-manager-backups-r2` |
| Endpoint | `https://b18eee30d3f2e5e888b4aa0869d831ad.r2.cloudflarestorage.com` |
| Keys | Live in local `.env` as `BACKUP_S3_*` — never commit |

Expected `.env` shape (values for keys stay in `.env` only):

```bash
BACKUP_S3_ENDPOINT=https://b18eee30d3f2e5e888b4aa0869d831ad.r2.cloudflarestorage.com
BACKUP_S3_BUCKET=server-manager-backups
BACKUP_S3_ACCESS_KEY=...
BACKUP_S3_SECRET_KEY=...
BACKUP_S3_REGION=auto
```

Upload path prefix (from `lib/backup.ts`): `s3://server-manager-backups/server-manager/<stamp>/`.

Deploy installs `aws` CLI on the VPS if missing. Success marker in backup log: `UPLOADED_S3`.

#### Rotate or recreate R2 credentials

1. Cloudflare dashboard → **R2** → **Manage API Tokens**
2. Revoke `server-manager-backups-r2` if needed
3. Create Account/User API token → **Object Read & Write** → scope to `server-manager-backups`
4. Copy Access Key ID + Secret Access Key into `.env`
5. `./scripts/deploy-vps.sh`

Programmatic note: Access Key ID = API token `id`; Secret Access Key = SHA-256 hex of the token `value` (see Cloudflare R2 auth docs). Prefer the R2 “Manage API Tokens” UI when unsure.

## 2. Create UI password (basic auth)

```bash
cd server-manager
chmod +x scripts/*.sh
./scripts/gen-htpasswd.sh 'choose-a-long-random-password'
# optional: AUTH_USER=ops ./scripts/gen-htpasswd.sh '...'
```

Default user is `admin`. Password may already exist in local `secrets/ui-password.txt`.

## 3. Deploy to the VPS

```bash
./scripts/deploy-vps.sh
```

This rsyncs the app to `/opt/server-manager`, sets `SSH_HOST=host.docker.internal`, builds prod images (`Dockerfile.prod` / `docker-compose.prod.yml`), binds **`127.0.0.1:3847` only**.

## 4. Reach the UI securely

### Option A — SSH tunnel (works immediately)

```bash
ssh -i ../azaf-codes.pem -L 3847:127.0.0.1:3847 root@46.224.210.19
```

Open http://127.0.0.1:3847 — browser will ask for basic auth.

### Option B — Tailscale (recommended)

On the VPS and your Mac:

1. Install Tailscale, log in to the same tailnet  
2. On VPS:

```bash
tailscale serve --bg http://127.0.0.1:3847
```

3. Open the MagicDNS URL Tailscale prints (only your tailnet can reach it)  
4. Basic auth still applies (defense in depth)

Do **not** publish port 3847 on the public `0.0.0.0` firewall.

## 5. Verify

- [ ] Telegram still works (stop a test URL or wait for host check)  
- [ ] http://127.0.0.1:3847 via tunnel asks for password  
- [ ] Live SSH connects (`SSH_HOST=host.docker.internal`)  
- [ ] `BACKUP_TARGETS` set and **Backup now** writes under `/root/server-manager-backups`  
- [ ] With R2 env on VPS, log contains `UPLOADED_S3`  
- [ ] Laptop sleep: Watchdog on VPS still alerts  

## 6. Local vs VPS

| | Local (`docker compose up`) | VPS (`docker-compose.prod.yml`) |
|--|--|--|
| Purpose | Dev UI | Always-on ops |
| URL | https://server-manager.apps.test | 127.0.0.1:3847 / Tailscale |
| Auth | none (trusted laptop) | nginx basic auth |
| Watchdog | only while Mac awake | 24/7 |

You can keep local for tinkering; treat VPS as the real watchdog.

## Cost checklist

- [ ] R2 stays on **Standard** free tier (≤10 GB, low Class A/B) — see [INVENTORY.md](../INVENTORY.md)  
- [ ] `BACKUP_KEEP_DAYS` stays small (default 7)  
- [ ] No paid Cloudflare Workers / add-ons / Infrequent Access  
- [ ] No extra Hetzner volumes or automated snapshots without asking  

## Security checklist

- [ ] Only `127.0.0.1:3847` published (compose default)  
- [ ] Strong basic auth password  
- [ ] Tailscale or SSH tunnel only — no public DNS to Server Manager  
- [ ] `.env` / `secrets/` never committed  
- [ ] Coolify UI also not world-open (Tailscale/firewall)  
- [ ] Rotate Telegram bot token if it was ever pasted in a screenshot  
- [ ] `secrets/htpasswd` is `644` so nginx can read it (deploy script sets this)  
