# Laravel queues (workers + Server Manager monitoring)

## Architecture

- Each Laravel app’s **GHCR `Dockerfile.prod`** image runs **supervisord** with `php-fpm`, `nginx`, and a **`queue-worker`** (`php artisan queue:work database …`).
- Coolify must set **`QUEUE_CONNECTION=database`** (not `sync`).
- Server Manager resolves containers by Coolify label **`coolify.projectName`** (stable across redeploys; `coolify.name` is the random UUID).

```
QUEUE_APPS="kinventory:coolify.projectName=kinventory:KInventory,rent-tracker:coolify.projectName=rent-tracker:Rent Tracker,who-owes-who:coolify.projectName=who-owes-who:Who Owes Who"
QUEUE_FAILED_ALERT=1
```

UI: Home → **Queues** (pending / failed / worker status; Retry / Flush / Restart / Failed list).  
Watchdog Telegram: worker DOWN or `failed_jobs > 0` (state-change only).

## Cutover checklist (one app at a time, off-peak)

**Status (2026-07-19):**
- **KInventory**, **rent-tracker**, **who-owes-who**: Coolify `build_pack=dockerimage` → `ghcr.io/azaf70/<app>:latest`, in-image supervisord `queue-worker`, host `laravel-queue@*` disabled.
- Private GHCR login is configured on the VPS; all three images can be pushed/pulled normally. The temporary `pull_policy: never` workaround has been removed.

Prereqs: Concurrent builds = **1**; disk preferably &lt;75%. See [PREVENT_SLOWDOWNS.md](PREVENT_SLOWDOWNS.md) / [ADD_LARAVEL_QUEUES.md](ADD_LARAVEL_QUEUES.md).

### Move worker into the app image (GHCR)

For a new standard Laravel app, start with:

```bash
./scripts/setup-laravel-ghcr.sh \
  --app /path/to/app \
  --image ghcr.io/azaf70/app \
  --project app \
  --name "App"
```

Then:

1. Review and push the generated `Dockerfile.prod`, `docker/prod/*`, and GHCR workflow.
2. Coolify → switch source to **Docker Image** `ghcr.io/<owner>/<repo>:latest` (keep `QUEUE_CONNECTION=database`; keep `ports_exposes`).
3. If the app had a Nixpacks storage mount under `/app/...`, move it to `/var/www/html/...` (same named volume).
4. Redeploy once; run `php artisan migrate --force` once if needed; then `systemctl disable --now laravel-queue@<project>`.
5. Verify HTTP 200, `queue:work` process up, Server Manager Queues panel green.

### Who Owes Who notes

Root `Dockerfile` listens on **80** (matches Coolify). Prod entrypoint must **not** run `DemoSeeder`. Strip `config/scribe.php` from the image (`knuckleswtf/scribe` is require-dev).

## Worker command (in image)

```ini
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
```

`--max-time=3600` recycles hourly; supervisord restarts it. Keep `numprocs=1` on the 4 GB VPS.

## Notes

- Monitoring works **before** cutover: it will show worker DOWN / driver `sync` until the GHCR image + env are live.
- Nixpacks path was `/app/artisan`; GHCR image uses `/var/www/html/artisan`. Server Manager probes both.
- No Redis / Horizon — stays on free-tier / existing VPS only.
