"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type BackupInfo = {
  remoteDir: string;
  targets: { engine: string; container: string; database: string }[];
  keepDays: number;
  s3Configured: boolean;
};

type BackupResult = {
  ok: boolean;
  remoteDir: string;
  log: string;
  error?: string;
  uploaded: boolean;
  finishedAt: string;
};

export function BackupPanel() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [result, setResult] = useState<BackupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/backup", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setInfo(json as BackupInfo);
        setError(null);
      } else {
        setError(json.error || "Failed to load backup config");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      const json = (await res.json()) as BackupResult;
      setResult(json);
      if (!json.ok) setError(json.error || "Backup failed");
      else setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <header className="section-head">
        <h2>Backups</h2>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy || !info?.targets.length}
          onClick={run}
        >
          {busy ? "Running…" : "Backup now"}
        </button>
      </header>

      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}

      {info && (
        <div className="backup-meta">
          <p className="muted">
            Remote dir <span className="mono">{info.remoteDir}</span> · keep{" "}
            {info.keepDays}d · off-box S3{" "}
            {info.s3Configured ? "configured" : "not set"}
          </p>
          {info.targets.length === 0 ? (
            <p className="muted">
              Set <span className="mono">BACKUP_TARGETS</span> in{" "}
              <span className="mono">.env</span> — e.g.{" "}
              <span className="mono">postgres:coolify-db:coolify</span>
            </p>
          ) : (
            <ul className="backup-targets">
              {info.targets.map((t) => (
                <li key={`${t.engine}:${t.container}:${t.database}`}>
                  <span className="mono">
                    {t.engine}:{t.container}:{t.database}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted">
            Restore steps:{" "}
            <Link href="/playbooks#restore-db">Playbooks → Restore DB</Link>
          </p>
        </div>
      )}

      {result && (
        <div className="logs-drawer backup-log" role="status">
          <header className="section-head">
            <h3>
              {result.ok ? "Backup OK" : "Backup failed"}
              {result.uploaded ? " · uploaded" : ""}
            </h3>
            <span className="muted mono">{result.remoteDir}</span>
          </header>
          <pre className="logs-body">{result.log || result.error}</pre>
        </div>
      )}
    </section>
  );
}
