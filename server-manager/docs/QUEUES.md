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

**Already live (2026-07-19):** all three Laravel apps use `QUEUE_CONNECTION=database` and host `laravel-queue@*` workers. Disk cleaned to ~58%.

Prereqs for future GHCR image cutover: Concurrent builds = **1**; disk preferably &lt;75%. See [PREVENT_SLOWDOWNS.md](PREVENT_SLOWDOWNS.md) / [ADD_LARAVEL_QUEUES.md](ADD_LARAVEL_QUEUES.md).

### Optional: move worker into the app image (GHCR)

1. Push `Dockerfile.prod` with `[program:queue-worker]` (already on main for kinventory / rent-tracker).
2. Coolify → switch source to GHCR image (keep `QUEUE_CONNECTION=database`).
3. Redeploy once; then `systemctl disable --now laravel-queue@<project>`.
4. Verify `supervisorctl status` shows `queue-worker RUNNING`.

### Who Owes Who / any app not cloned locally

Follow **[ADD_LARAVEL_QUEUES.md](ADD_LARAVEL_QUEUES.md)** (and `scripts/add-queue-worker.sh` for the image-side config).

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
