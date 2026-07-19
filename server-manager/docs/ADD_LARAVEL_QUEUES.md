# Add Laravel database queues to any Coolify app

Use this when the app repo is **not** already forked locally (e.g. who-owes-who) or when bootstrapping a new Laravel service on the VPS. Do **not** reinvent — follow this checklist.

Related: [QUEUES.md](QUEUES.md) (monitoring in Server Manager).

## Current production pattern (2026-07-19)

While apps still run on **Nixpacks** (no supervisord in the image):

1. Coolify env **`QUEUE_CONNECTION=database`** (encrypted in Coolify DB + `/data/coolify/applications/<uuid>/.env`).
2. Host systemd template **`laravel-queue@.service`** runs:
   `docker exec … php …/artisan queue:work database --sleep=3 --tries=3 --max-time=3600`
   Resolved by label `coolify.projectName=%i`.
3. Enabled units: `laravel-queue@kinventory`, `@rent-tracker`, `@who-owes-who`.

```bash
systemctl status 'laravel-queue@kinventory'
systemctl restart 'laravel-queue@rent-tracker'
# After Coolify redeploy, workers auto-retry (Restart=always) once the new container is up
```

When an app later moves to **GHCR `Dockerfile.prod`** with in-image `[program:queue-worker]`, disable that app’s host unit:

```bash
systemctl disable --now 'laravel-queue@kinventory'
```

## Goal (long-term)

- App image runs `queue:work database` under **supervisord** (auto-restart).
- Coolify env: `QUEUE_CONNECTION=database` (not `sync`).
- Server Manager monitors via `QUEUE_APPS` + label `coolify.projectName=<project>`.

## Prerequisites

- [ ] Disk headroom: prefer **&lt;75%** used (~10 GB free) before rebuilds. Safe reclaim: `docker builder prune -af` + `docker image prune -af` (**never** volumes).
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

GHCR image WORKDIR is `/var/www/html`. Nixpacks uses `/app/artisan`. Server Manager and `laravel-queue@` probe both.

## 2. Coolify env + workers (no local clone needed)

### A. Set `QUEUE_CONNECTION=database`

Preferred durable path (updates Coolify’s encrypted store so redeploys keep it):

```bash
# Inside coolify container — replace resourceable_id with applications.id
docker exec coolify php -r '
require "/var/www/html/vendor/autoload.php";
$app = require_once "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$e = App\Models\EnvironmentVariable::where("resourceable_id", APP_ID)
  ->where("resourceable_type","App\\Models\\Application")
  ->where("key","QUEUE_CONNECTION")->first();
$e->value = "database"; $e->save();
echo $e->fresh()->value, "\n";
'
```

Also set in the compose env file Coolify writes (immediate recreate):

```bash
# /data/coolify/applications/<uuid>/.env
QUEUE_CONNECTION=database
cd /data/coolify/applications/<uuid> && docker compose up -d --force-recreate --no-build
docker exec <container> php /app/artisan config:clear   # or /var/www/html/artisan
```

### B. Enable host worker (Nixpacks / until GHCR)

```bash
systemctl enable --now laravel-queue@<coolify.projectName>
# e.g. laravel-queue@who-owes-who
```

### C. Optional later: GHCR image cutover

1. Switch deploy source from Nixpacks → `ghcr.io/<owner>/<repo>:latest`.
2. Redeploy once (one app, off-peak, disk &lt;75%).
3. `systemctl disable --now laravel-queue@<project>` if supervisord runs the worker inside the image.

## 3. Server Manager `QUEUE_APPS`

```
id:coolify.projectName=<projectName>:Display Name
```

```
QUEUE_APPS="kinventory:coolify.projectName=kinventory:KInventory,rent-tracker:coolify.projectName=rent-tracker:Rent Tracker,who-owes-who:coolify.projectName=who-owes-who:Who Owes Who"
QUEUE_FAILED_ALERT=1
```

## 4. Verify

```bash
PROJECT=who-owes-who
C=$(docker ps --filter "label=coolify.projectName=$PROJECT" -q | head -1)
docker exec "$C" printenv QUEUE_CONNECTION          # database
docker exec "$C" php /app/artisan about | grep -i Queue
systemctl is-active "laravel-queue@$PROJECT"        # active
```

Server Manager → **Queues**: driver `database`, worker green.

## 5. If something fails

| Symptom | Fix |
|---------|-----|
| Driver still `sync` | Coolify env + `.env` + recreate; `config:clear` |
| Worker DOWN | `systemctl status laravel-queue@…` / restart unit |
| After Coolify redeploy worker flaps | Normal briefly; systemd retries in 8s |
| Disk spike during build | Prune unused images/cache first; one app at a time |

## Cost / constraints

- No Redis, no Horizon, no extra containers.
- Host workers are lightweight (`docker exec`); prefer in-image supervisord after GHCR cutover.
- Stay within the Server Manager cost budget (see `INVENTORY.md`).
