"use client";

import { useCallback, useEffect, useState } from "react";

type QueueApp = {
  id: string;
  name: string;
  container: string | null;
  pending: number | null;
  failed: number | null;
  workerUp: boolean | null;
  queueDriver: string | null;
  error: string | null;
  checkedAt: string;
};

export function QueuePanel() {
  const [apps, setApps] = useState<QueueApp[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [output, setOutput] = useState<{ name: string; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/queues", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Failed to load queues");
        setApps([]);
        setWarning(null);
      } else {
        setApps((json.apps as QueueApp[]) || []);
        setWarning(typeof json.warning === "string" ? json.warning : null);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load queues");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, action: string, name: string) => {
    setBusy(`${action}:${id}`);
    try {
      const res = await fetch(`/api/queues/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (action === "failed") {
        setOutput({
          name,
          text:
            typeof json.output === "string"
              ? json.output || "(no failed jobs)"
              : json.error || "No output",
        });
      } else if (!json.ok) {
        setError(json.error || `${action} failed`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="section panel-card queues-section">
      <header className="section-head">
        <div className="section-head-left">
          <h2>Queues</h2>
          {apps.length > 0 && (
            <span className="muted mono container-count">{apps.length}</span>
          )}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
          Refresh
        </button>
      </header>

      {loading && apps.length === 0 && !error && !warning && (
        <p className="skeleton">Loading queues…</p>
      )}

      {warning && (
        <p className="muted" role="status">
          {warning}
        </p>
      )}

      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}

      {apps.length > 0 && (
        <div className="docker-list">
          {apps.map((a) => {
            const workerOk = a.workerUp === true;
            const workerUnknown = a.workerUp === null;
            const failedBad = (a.failed ?? 0) > 0;
            return (
              <div className="docker-row" key={a.id}>
                <div className="docker-main">
                  <div className="docker-name">
                    <span
                      className={`status-dot${workerOk ? " on" : ""}`}
                      aria-hidden
                      title={
                        workerOk
                          ? "Worker running"
                          : workerUnknown
                            ? "Worker status unknown"
                            : "Worker down"
                      }
                    />
                    {a.name}
                  </div>
                  <div className="docker-image" title={a.container || ""}>
                    {a.queueDriver
                      ? `driver ${a.queueDriver}`
                      : a.container
                        ? a.container.slice(0, 12)
                        : "no container"}
                    {a.error ? ` · ${a.error}` : ""}
                  </div>
                </div>
                <div
                  className="docker-status"
                  title={`Pending ${a.pending ?? "—"} · Failed ${a.failed ?? "—"}`}
                >
                  <span className="mono">
                    {a.pending ?? "—"} pend
                    {failedBad ? (
                      <span style={{ color: "var(--danger)" }}>
                        {" "}
                        · {a.failed} fail
                      </span>
                    ) : (
                      <> · {a.failed ?? "—"} fail</>
                    )}
                  </span>
                  {!workerOk && !workerUnknown && (
                    <span
                      className="muted"
                      style={{ display: "block", color: "var(--danger)" }}
                    >
                      worker down
                    </span>
                  )}
                </div>
                <div className="docker-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={!!busy || !a.container}
                    onClick={() => act(a.id, "failed", a.name)}
                  >
                    Failed
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={!!busy || !a.container}
                    onClick={() => act(a.id, "retry", a.name)}
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={!!busy || !a.container}
                    onClick={() => act(a.id, "restart", a.name)}
                  >
                    Restart
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger-ghost"
                    disabled={!!busy || !a.container}
                    onClick={() => {
                      if (
                        typeof window !== "undefined" &&
                        !window.confirm(
                          `Flush all failed jobs for ${a.name}? This cannot be undone.`,
                        )
                      ) {
                        return;
                      }
                      void act(a.id, "flush", a.name);
                    }}
                  >
                    Flush
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && !warning && apps.length === 0 && (
        <p className="muted">No queue apps configured.</p>
      )}

      {output && (
        <div className="logs-drawer" role="dialog" aria-label="Failed jobs">
          <header className="section-head">
            <h3>Failed — {output.name}</h3>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setOutput(null)}
            >
              Close
            </button>
          </header>
          <pre className="logs-body">{output.text}</pre>
        </div>
      )}
    </section>
  );
}
