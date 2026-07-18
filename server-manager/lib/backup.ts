import { sshExec } from "./ssh";

export type BackupTarget = {
  engine: "postgres" | "mysql";
  container: string;
  database: string;
  /** Optional DB user. Postgres defaults to $POSTGRES_USER in the container. */
  user?: string;
};

export type BackupResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  remoteDir: string;
  targets: BackupTarget[];
  log: string;
  error?: string;
  uploaded: boolean;
};

function parseTargets(): BackupTarget[] {
  const raw = process.env.BACKUP_TARGETS ?? "";
  const out: BackupTarget[] = [];
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    // engine:container:dbname[:user]
    const [engine, container, database, user] = part.split(":");
    if (
      (engine === "postgres" || engine === "mysql") &&
      container &&
      database
    ) {
      out.push({
        engine,
        container,
        database,
        user: user || undefined,
      });
    }
  }
  return out;
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Escape for use inside a double-quoted shell string (no $ expansion of the value). */
function shellEscape(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`")}"`;
}

export function getBackupConfig() {
  return {
    remoteDir: process.env.BACKUP_REMOTE_DIR || "/root/server-manager-backups",
    targets: parseTargets(),
    keepDays: Number(process.env.BACKUP_KEEP_DAYS ?? "7") || 7,
    s3Configured: Boolean(
      process.env.BACKUP_S3_ENDPOINT &&
        process.env.BACKUP_S3_BUCKET &&
        process.env.BACKUP_S3_ACCESS_KEY &&
        process.env.BACKUP_S3_SECRET_KEY,
    ),
    s3: {
      endpoint: process.env.BACKUP_S3_ENDPOINT || "",
      bucket: process.env.BACKUP_S3_BUCKET || "",
      accessKey: process.env.BACKUP_S3_ACCESS_KEY || "",
      secretKey: process.env.BACKUP_S3_SECRET_KEY || "",
      region: process.env.BACKUP_S3_REGION || "auto",
    },
  };
}

export async function runBackup(): Promise<BackupResult> {
  const startedAt = new Date().toISOString();
  const cfg = getBackupConfig();
  if (cfg.targets.length === 0) {
    return {
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      remoteDir: cfg.remoteDir,
      targets: [],
      log: "",
      error:
        "No BACKUP_TARGETS configured. Format: postgres:container:dbname[:user] (comma-separated)",
      uploaded: false,
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = `${cfg.remoteDir}/${stamp}`;

  const parts: string[] = [
    `mkdir -p ${shQuote(dir)}`,
    `echo Backup_dir=${shQuote(dir)}`,
  ];

  for (const t of cfg.targets) {
    const file = `${t.engine}-${t.container}-${t.database}.sql.gz`;
    const out = `${dir}/${file}`;
    if (t.engine === "postgres") {
      // Coolify images use POSTGRES_USER=coolify (no postgres role).
      // Outer shQuote prevents host expansion; container sh expands $POSTGRES_USER.
      const dumpCmd = t.user
        ? `pg_dump -U ${shellEscape(t.user)} ${shellEscape(t.database)}`
        : `pg_dump -U "\${POSTGRES_USER:-postgres}" ${shellEscape(t.database)}`;
      parts.push(
        `echo Dumping_postgres_${t.container}_${t.database}`,
        `docker exec ${shQuote(t.container)} sh -c ${shQuote(dumpCmd)} | gzip -c > ${shQuote(out)}`,
        `ls -la ${shQuote(out)}`,
      );
    } else {
      // MYSQL_ROOT_PASSWORD comes from the container env (Coolify MySQL images)
      const user = t.user || "root";
      const dumpCmd = `mysqldump -u${shellEscape(user)} -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers ${shellEscape(t.database)}`;
      parts.push(
        `echo Dumping_mysql_${t.container}_${t.database}`,
        `docker exec ${shQuote(t.container)} sh -c ${shQuote(dumpCmd)} | gzip -c > ${shQuote(out)}`,
        `ls -la ${shQuote(out)}`,
      );
    }
  }

  parts.push(
    `find ${shQuote(cfg.remoteDir)} -mindepth 1 -maxdepth 1 -type d -mtime +${cfg.keepDays} -exec rm -rf {} +`,
    `echo Prune_done`,
    `ls -la ${shQuote(dir)}`,
  );

  if (cfg.s3Configured) {
    const { endpoint, bucket, accessKey, secretKey, region } = cfg.s3;
    // Cloudflare R2 + other S3-compatible stores via AWS CLI on the host
    parts.push(
      `if command -v aws >/dev/null 2>&1; then ` +
        `AWS_ACCESS_KEY_ID=${shQuote(accessKey)} ` +
        `AWS_SECRET_ACCESS_KEY=${shQuote(secretKey)} ` +
        `AWS_DEFAULT_REGION=${shQuote(region)} ` +
        `AWS_ENDPOINT_URL=${shQuote(endpoint)} ` +
        `AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED ` +
        `AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED ` +
        `aws s3 cp ${shQuote(dir)} s3://${bucket}/server-manager/${stamp}/ --recursive ` +
        `&& echo UPLOADED_S3; ` +
        `else echo NO_AWS_CLI_dumps_on_vps_only; fi`,
    );
  } else {
    parts.push(`echo S3_not_configured_dumps_on_vps_only`);
  }

  const remote = parts.join(" && ");

  try {
    const { stdout, stderr, code } = await sshExec(remote, 300_000);
    const log = [stdout, stderr].filter(Boolean).join("\n");
    const ok = code === 0;
    return {
      ok,
      startedAt,
      finishedAt: new Date().toISOString(),
      remoteDir: dir,
      targets: cfg.targets,
      log,
      error: ok ? undefined : stderr || `exit ${code}`,
      uploaded: ok && log.includes("UPLOADED_S3"),
    };
  } catch (err) {
    return {
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      remoteDir: dir,
      targets: cfg.targets,
      log: "",
      error: err instanceof Error ? err.message : "backup failed",
      uploaded: false,
    };
  }
}
