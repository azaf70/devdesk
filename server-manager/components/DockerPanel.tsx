"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Container = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
};

export function DockerPanel() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ name: string; text: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/docker", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Failed to list containers");
        setContainers([]);
      } else {
        setContainers(json.containers as Container[]);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Docker");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!menuFor) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuFor(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuFor(null);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  const act = async (id: string, action: string, name: string) => {
    setBusy(`${action}:${id}`);
    setMenuFor(null);
    try {
      const res = await fetch(`/api/docker/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (action === "logs") {
        const text =
          typeof json.logs === "string"
            ? json.logs
            : json.error || "No log output";
        setLogs({ name, text: text || "(empty)" });
        if (!json.ok && !json.logs) {
          setError(json.error || "Failed to fetch logs");
        }
      } else if (!json.ok) {
        setError(json.error || `${action} failed`);
      }
      if (action !== "logs") await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="section panel-card containers-section">
      <header className="section-head">
        <div className="section-head-left">
          <h2>Containers</h2>
          {containers.length > 0 && (
            <span className="muted mono container-count">
              {containers.length}
            </span>
          )}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
          Refresh
        </button>
      </header>

      {loading && containers.length === 0 && !error && (
        <p className="skeleton">Loading containers…</p>
      )}

      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}

      {containers.length > 0 && (
        <div className="docker-list">
          {containers.map((c) => {
            const running = /running/i.test(c.state || c.status);
            const shortStatus = (c.status || c.state || "—").replace(
              /^Up /,
              "",
            );
            const open = menuFor === c.id;
            return (
              <div className="docker-row" key={c.id}>
                <div className="docker-main">
                  <div className="docker-name">
                    <span
                      className={`status-dot${running ? " on" : ""}`}
                      aria-hidden
                    />
                    {c.name || c.id.slice(0, 12)}
                  </div>
                  <div className="docker-image" title={c.image}>
                    {c.image}
                  </div>
                </div>
                <div className="docker-status" title={c.status || c.state}>
                  {running ? `Up ${shortStatus}` : shortStatus}
                </div>
                <div className="docker-actions">
                  {running ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger-ghost"
                      disabled={!!busy}
                      onClick={() => act(c.id, "stop", c.name)}
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={!!busy}
                      onClick={() => act(c.id, "start", c.name)}
                    >
                      Start
                    </button>
                  )}
                  <div
                    className="docker-more"
                    ref={open ? menuRef : undefined}
                  >
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={!!busy}
                      aria-expanded={open}
                      aria-haspopup="menu"
                      onClick={() => setMenuFor(open ? null : c.id)}
                    >
                      More
                    </button>
                    {open && (
                      <div className="docker-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className="docker-menu-item"
                          disabled={!!busy}
                          onClick={() => act(c.id, "restart", c.name)}
                        >
                          Restart
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="docker-menu-item"
                          disabled={!!busy}
                          onClick={() => act(c.id, "logs", c.name)}
                        >
                          Logs
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && containers.length === 0 && (
        <p className="muted">No containers found.</p>
      )}

      {logs && (
        <div className="logs-drawer" role="dialog" aria-label="Container logs">
          <header className="section-head">
            <h3>Logs — {logs.name}</h3>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setLogs(null)}
            >
              Close
            </button>
          </header>
          <pre className="logs-body">{logs.text}</pre>
        </div>
      )}
    </section>
  );
}
