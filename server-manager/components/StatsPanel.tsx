"use client";

import { useCallback, useEffect, useState } from "react";

type Stats = {
  ok: true;
  host: string;
  uname: string;
  uptimeSec: number;
  load: { "1m": number; "5m": number; "15m": number };
  memory: {
    totalKb: number | null;
    availableKb: number | null;
    usedKb: number | null;
  };
  disk: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
  };
  checkedAt: string;
};

type StatsError = { ok: false; error: string };

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatKb(kb: number | null): string {
  if (kb == null) return "—";
  return formatBytes(kb * 1024);
}

function pct(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

export function StatsPanel() {
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      const json = (await res.json()) as Stats | StatsError;
      if (!json.ok) {
        setError(json.error);
        setData(null);
      } else {
        setData(json);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  const memPct =
    data?.memory.usedKb != null && data.memory.totalKb
      ? pct(data.memory.usedKb, data.memory.totalKb)
      : 0;
  const diskPct = data ? pct(data.disk.usedBytes, data.disk.totalBytes) : 0;

  return (
    <section className="status-strip" aria-label="Server overview">
      {loading && !data && !error && (
        <p className="skeleton status-strip-msg">Checking server…</p>
      )}

      {error && (
        <p className="error-banner status-strip-msg" role="alert">
          {error}
        </p>
      )}

      {data && (
        <div className="metrics">
          <div className="metric">
            <span className="metric-label">Host</span>
            <span className="metric-value mono metric-value-host">
              {data.host}
            </span>
            <span className="metric-sub" title={data.uname}>
              {data.uname}
            </span>
          </div>
          <div className="metric">
            <span className="metric-label">Uptime</span>
            <span className="metric-value">
              {formatUptime(data.uptimeSec)}
            </span>
            <span className="metric-sub">
              load {data.load["1m"].toFixed(2)} · {data.load["5m"].toFixed(2)} ·{" "}
              {data.load["15m"].toFixed(2)}
            </span>
          </div>
          <div className="metric">
            <span className="metric-label">Memory</span>
            <span className="metric-value">{memPct}%</span>
            <div className="meter" aria-hidden>
              <div className="meter-fill" style={{ width: `${memPct}%` }} />
            </div>
            <span className="metric-sub">
              {formatKb(data.memory.usedKb)} / {formatKb(data.memory.totalKb)}
            </span>
          </div>
          <div className="metric">
            <span className="metric-label">Disk</span>
            <span className="metric-value">{diskPct}%</span>
            <div className="meter" aria-hidden>
              <div className="meter-fill" style={{ width: `${diskPct}%` }} />
            </div>
            <span className="metric-sub">
              {formatBytes(data.disk.usedBytes)} /{" "}
              {formatBytes(data.disk.totalBytes)}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
