# who-owes-who production Docker assets

Copy into `azaf70/who-owes-who` at the repo root:

- `Dockerfile.prod`
- `docker/prod/entrypoint.sh`
- `docker/prod/supervisord.conf`
- `docker/prod/nginx.conf`

These were used for the 2026-07-19 Coolify cutover (`ports_exposes=80`, image `ghcr.io/azaf70/who-owes-who:latest`). Prod entrypoint does **not** run migrations or `DemoSeeder`, refuses missing `APP_KEY` / `APP_DEBUG=true`, and strips `config/scribe.php` because Scribe is require-dev.
