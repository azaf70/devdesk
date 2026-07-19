"use client";

import { useCallback, useEffect, useState } from "react";

type UrlCheck = {
  url: string;
  ok: boolean;
  status: number | null;
  error: string | null;
  latencyMs: number;
  checkedAt: string;
};

type HostAlert = { key: string; ok: boolean; message: string };

type Snapshot = {
  urls: UrlCheck[];
  configuredUrls?: string[];
  hostAlerts: HostAlert[];
  hostError: string | null;
  lastRunAt: string | null;
  telegramConfigured: boolean;
  intervalMs: number;
};

function shortLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return `${u.host}${path}`;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const sec = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  return `${m}m ago`;
}

export function WatchdogPanel() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Health check failed");
        return;
      }
      setData(json as Snapshot);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load health");
    }
  }, []);

  const runNow = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/health", { method: "POST" });
      const json = await res.json();
      if (json.ok) setData(json as Snapshot);
      else setError(json.error || "Check failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const allUrlOk =
    data && data.urls.length > 0 ? data.urls.every((u) => u.ok) : null;
  const downCount = data?.urls.filter((u) => !u.ok).length ?? 0;

  return (
    <section className="section panel-card">
      <header className="section-head">
        <div className="section-head-left">
          <h2>Health</h2>
          {allUrlOk === true && (
            <span className="status-chip status-connected">All up</span>
          )}
          {allUrlOk === false && (
            <span className="status-chip status-disconnected">
              {downCount} down
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={runNow}
        >
          Check now
        </button>
      </header>

      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}

      {!data && !error && <p className="skeleton">Loading health…</p>}

      {data && (
        <>
          <div className="watchdog-meta-row">
            <p className="muted watchdog-meta">
              Checked {timeAgo(data.lastRunAt)}
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowMeta((v) => !v)}
              aria-expanded={showMeta}
            >
              {showMeta ? "Hide" : "Details"}
            </button>
          </div>

          {showMeta && (
            <p className="muted watchdog-meta-detail">
              {Math.round(data.intervalMs / 1000)}s cycle · Telegram{" "}
              {data.telegramConfigured ? "on" : "off"}
            </p>
          )}

          {data.urls.length === 0 &&
            (data.configuredUrls?.length ?? 0) === 0 && (
              <p className="muted">
                Set <span className="mono">WATCHDOG_URLS</span> in{" "}
                <span className="mono">.env</span>, then recreate the app
                container.
              </p>
            )}

          {data.urls.length === 0 &&
            (data.configuredUrls?.length ?? 0) > 0 && (
              <p className="muted">
                Checking {data.configuredUrls!.length} URLs…
              </p>
            )}

          {(data.urls.length > 0 || data.hostAlerts.length > 0) && (
            <div className="watchdog-board">
              {data.urls.map((u) => (
                <div
                  className={`wd-row${u.ok ? "" : " wd-row-bad"}`}
                  key={u.url}
                >
                  <span
                    className={`status-dot${u.ok ? " on" : ""}`}
                    aria-hidden
                  />
                  <a
                    className="wd-label mono"
                    href={u.url}
                    target="_blank"
                    rel="noreferrer"
                    title={u.url}
                  >
                    {shortLabel(u.url)}
                  </a>
                  <span className="wd-meta mono">
                    {u.ok
                      ? u.latencyMs >= 1000
                        ? `${u.status} · ${u.latencyMs}ms`
                        : String(u.status)
                      : u.error || "down"}
                  </span>
                </div>
              ))}

              {data.urls.length > 0 && data.hostAlerts.length > 0 && (
                <div className="wd-divider" aria-hidden />
              )}

              {data.hostError && (
                <div className="wd-row wd-row-bad">
                  <span className="status-dot" aria-hidden />
                  <span className="wd-label">Host SSH</span>
                  <span className="wd-meta">{data.hostError}</span>
                </div>
              )}

              {data.hostAlerts.map((a) => (
                <div
                  className={`wd-row${a.ok ? "" : " wd-row-bad"}`}
                  key={a.key}
                >
                  <span
                    className={`status-dot${a.ok ? " on" : ""}`}
                    aria-hidden
                  />
                  <span className="wd-label">
                    {a.key === "disk"
                      ? "Disk"
                      : a.key === "memory"
                        ? "Memory"
                        : a.key}
                  </span>
                  <span className="wd-meta mono">{a.message}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
