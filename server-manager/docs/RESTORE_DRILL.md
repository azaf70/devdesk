# Restore drill checklist

Do this once on a **non-production** database before you trust backups.

## From on-VPS dump

1. Run **Backup now** in Server Manager (requires `BACKUP_TARGETS` in `.env`).
2. Note the dump path from the backup log (e.g. `/root/server-manager-backups/<stamp>/postgres-….sql.gz`).
3. Create or pick a throwaway DB / staging instance.
4. Restore:

```bash
# Postgres example (on the VPS)
gunzip -c /root/server-manager-backups/<stamp>/postgres-CONTAINER-DB.sql.gz \
  | docker exec -i CONTAINER psql -U postgres DBNAME
```

5. Open the app against that DB and verify data.
6. Tick the Phase 3 gate in [PHASE3.md](PHASE3.md) and note the date in [INVENTORY.md](../INVENTORY.md).

## From Cloudflare R2 (off-box)

Bucket: `server-manager-backups`  
Prefix: `server-manager/<stamp>/`  
Endpoint / keys: `BACKUP_S3_*` in `.env` (see [INVENTORY.md](../INVENTORY.md)).

```bash
# On a machine with aws CLI + R2 credentials configured
aws s3 cp \
  "s3://server-manager-backups/server-manager/<stamp>/" \
  ./restore-tmp/ \
  --recursive \
  --endpoint-url "https://b18eee30d3f2e5e888b4aa0869d831ad.r2.cloudflarestorage.com" \
  --region auto

gunzip -c ./restore-tmp/postgres-CONTAINER-DB.sql.gz \
  | docker exec -i CONTAINER psql -U postgres DBNAME
```

Success of the original backup upload is logged as `UPLOADED_S3`.

If restore fails, fix backup targets / permissions before adding Coolify or Hetzner automation.
