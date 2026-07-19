# Laravel queues (workers + Server Manager monitoring)

## Architecture

- Each Laravel app’s **GHCR `Dockerfile.prod`** image runs **supervisord** with `php-fpm`, `nginx`, and a **`queue-worker`** (`php artisan queue:work database …`).
- Coolify must set **`QUEUE_CONNECTION=database`** (not `sync`).
- Server Manager resolves containers by Coolify label **`coolify.projectName`** (stable across redeploys; `coolify.name` is the random UUID).

```
QUEUE_APPS=kinventory:coolify.projectName=kinventory:KInventory,rent-tracker:coolify.projectName=rent-tracker:Rent Tracker,who-owes-who:coolify.projectName=who-owes-who:Who Owes Who
QUEUE_FAILED_ALERT=1
```

UI: Home → **Queues** (pending / failed / worker status; Retry / Flush / Restart / Failed list).  
Watchdog Telegram: worker DOWN or `failed_jobs > 0` (state-change only).

## Cutover checklist (one app at a time, off-peak)

Prereqs: Concurrent builds = **1** in Coolify. See [PREVENT_SLOWDOWNS.md](PREVENT_SLOWDOWNS.md).

### KInventory (first)

1. Merge / push `feat/queue-worker` so GHCR builds an image with `[program:queue-worker]` in `docker/prod/supervisord.conf`.
2. Coolify → KInventory → Environment: set `QUEUE_CONNECTION=database`.
3. Switch deploy source from Nixpacks to Docker image `ghcr.io/<owner>/kinventory:latest` (or `:sha`).
4. Redeploy once.
5. Verify:

```bash
C=$(docker ps --filter label=coolify.projectName=kinventory -q | head -1)
docker exec "$C" php /var/www/html/artisan about | grep -i Queue   # database
docker exec "$C" supervisorctl status                              # queue-worker RUNNING
docker exec "$C" sh -c 'ps aux | grep "[q]ueue:work"'
```

### Rent Tracker

Same recipe: image `ghcr.io/<owner>/rent-tracker:latest`, env `QUEUE_CONNECTION=database`, label `coolify.projectName=rent-tracker`.

### Who Owes Who / any app not cloned locally

Follow the full checklist: **[ADD_LARAVEL_QUEUES.md](ADD_LARAVEL_QUEUES.md)** (and `scripts/add-queue-worker.sh`).

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
