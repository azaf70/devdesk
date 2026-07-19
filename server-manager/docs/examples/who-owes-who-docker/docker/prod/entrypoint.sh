#!/bin/sh
set -e
cd /var/www/html

# Explicit paths — Alpine /bin/sh does not expand {a,b} braces.
mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views storage/logs bootstrap/cache
touch storage/logs/laravel.log
chown -R www-data:www-data storage bootstrap/cache 2>/dev/null || true

if [ -z "${APP_KEY:-}" ] || [ "$APP_KEY" = "base64:" ]; then
  echo "APP_KEY missing; refusing to start" >&2
  exit 1
fi

case "${APP_DEBUG:-false}" in
  true|TRUE|1|yes|YES|on|ON)
    echo "APP_DEBUG must be false in this production image; refusing to start" >&2
    exit 1
    ;;
esac

if [ "${APP_ENV:-production}" = "local" ] || [ "${APP_ENV:-production}" = "testing" ]; then
  echo "APP_ENV=${APP_ENV} is not allowed in this production image; refusing to start" >&2
  exit 1
fi

# No migrate/DemoSeeder here — production cutovers run migrations deliberately.
php artisan storage:link --force 2>/dev/null || php artisan storage:link 2>/dev/null || true
php artisan config:cache 2>/dev/null || true
php artisan route:cache 2>/dev/null || true
php artisan view:cache 2>/dev/null || true
chown -R www-data:www-data storage bootstrap/cache 2>/dev/null || true

exec "$@"
