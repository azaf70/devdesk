"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal as XTermType } from "@xterm/xterm";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type Status = "connecting" | "connected" | "disconnected";

type TerminalProps = {
  onClose?: () => void;
};

export function Terminal({ onClose }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTermType | null>(null);
  const fitRef = useRef<FitAddonType | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [nonce, setNonce] = useState(0);

  const reconnect = useCallback(() => {
    wsRef.current?.close();
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    let onData: { dispose: () => void } | null = null;
    let ro: ResizeObserver | null = null;
    let onResize: (() => void) | null = null;

    (async () => {
      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (cancelled || !containerRef.current) return;

      const term = new XTerm({
        cursorBlink: true,
        fontSize: 13,
        lineHeight: 1.35,
        fontFamily:
          '"IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace',
        theme: {
          background: "#0a0d11",
          foreground: "#d7dee8",
          cursor: "#3dd6c6",
          cursorAccent: "#0a0d11",
          selectionBackground: "#2a3544",
          black: "#0a0d11",
          red: "#f07178",
          green: "#3dd6c6",
          yellow: "#e8b86d",
          blue: "#82aaff",
          magenta: "#c792ea",
          cyan: "#89ddff",
          white: "#d7dee8",
          brightBlack: "#546178",
          brightRed: "#ff8b92",
          brightGreen: "#6ae4c8",
          brightYellow: "#f0c988",
          brightBlue: "#9db8ff",
          brightMagenta: "#d4a8f0",
          brightCyan: "#a6e6ff",
          brightWhite: "#ffffff",
        },
        allowProposedApi: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/terminal`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        setStatus("connected");
        ws.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
        );
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          term.write(ev.data);
        } else {
          term.write(new Uint8Array(ev.data as ArrayBuffer));
        }
      };

      ws.onclose = () => {
        setStatus("disconnected");
        term.writeln("\r\n\x1b[33mDisconnected — click Reconnect\x1b[0m");
      };

      ws.onerror = () => {
        setStatus("disconnected");
      };

      onData = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      onResize = () => {
        fit.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: term.cols,
              rows: term.rows,
            }),
          );
        }
      };

      ro = new ResizeObserver(onResize);
      ro.observe(containerRef.current);
      window.addEventListener("resize", onResize);
    })();

    return () => {
      cancelled = true;
      onData?.dispose();
      ro?.disconnect();
      if (onResize) window.removeEventListener("resize", onResize);
      wsRef.current?.close();
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [nonce]);

  const statusLabel =
    status === "connecting"
      ? "Connecting"
      : status === "connected"
        ? "Connected"
        : "Disconnected";

  return (
    <section className="terminal-section">
      <header className="terminal-chrome">
        <div className="section-head-left">
          <h2>Live SSH</h2>
          <span className={`status-chip status-${status}`}>{statusLabel}</span>
        </div>
        <div className="terminal-chrome-actions">
          <button type="button" className="btn btn-sm" onClick={reconnect}>
            Reconnect
          </button>
          {onClose && (
            <button type="button" className="btn btn-sm" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </header>
      <div className="terminal-frame" ref={containerRef} />
    </section>
  );
}
