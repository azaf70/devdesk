# Add Laravel database queues to any Coolify app

Use this when the app repo is **not** already forked locally (e.g. who-owes-who) or when bootstrapping a new Laravel service on the VPS. Do **not** reinvent — follow this checklist.

Related: [QUEUES.md](QUEUES.md) (monitoring in Server Manager).

## Goal

- App image runs `queue:work database` under **supervisord** (auto-restart).
- Coolify env: `QUEUE_CONNECTION=database` (not `sync`).
- Server Manager monitors via `QUEUE_APPS` + label `coolify.projectName=<project>`.

## Prerequisites

- [ ] App has (or will get) a `Dockerfile.prod` that installs `supervisor` and starts with `supervisord -c /etc/supervisord.conf`.
- [ ] Laravel queue tables exist (`jobs`, `failed_jobs`, `job_batches`) — run migrations if needed.
- [ ] MySQL (or whatever DB) is reachable from the app container.
- [ ] GHCR workflow builds `Dockerfile.prod` on push to `main` (or you build/push manually).
- [ ] Coolify Concurrent builds = 1; do cutover **off-peak**, one app at a time.

## 1. Code changes (in the app repo)

### A. `docker/prod/supervisord.conf`

Ensure these programs exist: `php-fpm`, `nginx`, and:

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

Or run from Server Manager checkout:

```bash
./scripts/add-queue-worker.sh /path/to/laravel-app
```

### B. Env defaults

- `config/queue.php` default should be `env('QUEUE_CONNECTION', 'database')`.
- `.env.example`: `QUEUE_CONNECTION=database`.

### C. Artisan path

GHCR image WORKDIR is `/var/www/html`. If the app still uses Nixpacks, artisan is at `/app/artisan` until cutover — Server Manager probes both.

## 2. Coolify (manual UI)

1. Environment → set **`QUEUE_CONNECTION=database`**.
2. Switch deploy source from Nixpacks → Docker image, e.g. `ghcr.io/<owner>/<repo>:latest`.
3. Redeploy once.
4. Note the Coolify **project name** (label `coolify.projectName`). Examples already in prod:
   - `kinventory`
   - `rent-tracker`
   - `who-owes-who`

## 3. Server Manager `QUEUE_APPS`

Add (or confirm) a comma-separated entry in `.env` / VPS `.env`:

```
id:coolify.projectName=<projectName>:Display Name
```

Example for who-owes-who (already listed in `.env.example`):

```
who-owes-who:coolify.projectName=who-owes-who:Who Owes Who
```

Redeploy Server Manager (or restart the app container) so env is picked up. Full line pattern:

```
QUEUE_APPS="kinventory:coolify.projectName=kinventory:KInventory,rent-tracker:coolify.projectName=rent-tracker:Rent Tracker,who-owes-who:coolify.projectName=who-owes-who:Who Owes Who"
QUEUE_FAILED_ALERT=1
```

## 4. Verify (SSH on VPS)

```bash
PROJECT=who-owes-who   # or kinventory / rent-tracker / …
C=$(docker ps --filter "label=coolify.projectName=$PROJECT" -q | head -1)
echo "container=$C"
docker exec "$C" php /var/www/html/artisan about | grep -i Queue
# expect: database

docker exec "$C" supervisorctl status
# expect: queue-worker RUNNING

docker exec "$C" sh -c 'ps aux | grep "[q]ueue:work"'
```

Then open Server Manager → **Queues**: pending/failed counts, worker dot green.

## 5. If something fails

Playbook: Server Manager → Playbooks → “Laravel queue worker down / jobs stuck”.

Common causes:

| Symptom | Fix |
|---------|-----|
| Driver still `sync` | Coolify env + redeploy; config cache: `php artisan config:clear` |
| No supervisor / no queue-worker | Still on Nixpacks — cut over to GHCR image |
| Worker DOWN after GHCR | Check `supervisorctl status` + container logs |
| Wrong / no container in UI | Fix `QUEUE_APPS` label to match `coolify.projectName` |

## Cost / constraints

- No Redis, no Horizon, no extra containers — worker lives in the app container.
- `numprocs=1` on the 4 GB VPS.
- Stay within the Server Manager cost budget (see `INVENTORY.md`).
