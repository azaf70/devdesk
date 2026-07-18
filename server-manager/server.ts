import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { Client } from "ssh2";
import { connectConfig, getSshConfig } from "./lib/ssh";

// Load .env / .env.local without requiring dotenv package
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnvFile(file: string, { override = true } = {}) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Prefer values from the mounted .env over stale/empty Docker env_file
    if (override || !(key in process.env) || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

type ResizeMessage = { type: "resize"; cols: number; rows: number };

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "");
    if (pathname === "/ws/terminal") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    let ssh: Client | null = null;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      try {
        ssh?.end();
      } catch {
        /* ignore */
      }
      ssh = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };

    ws.on("close", cleanup);
    ws.on("error", cleanup);

    let cfg;
    try {
      cfg = getSshConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "SSH config error";
      ws.send(`\r\n\x1b[31m${msg}\x1b[0m\r\n`);
      cleanup();
      return;
    }

    ssh = new Client();
    ssh
      .on("ready", () => {
        ssh!.shell(
          { term: "xterm-256color", cols: 80, rows: 24 },
          (err, stream) => {
            if (err) {
              ws.send(`\r\n\x1b[31mShell error: ${err.message}\x1b[0m\r\n`);
              cleanup();
              return;
            }

            if (ws.readyState === WebSocket.OPEN) {
              ws.send("\x1b[32m✓ Connected to " + cfg.host + "\x1b[0m\r\n");
            }

            stream.on("data", (data: Buffer) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
              }
            });

            stream.stderr.on("data", (data: Buffer) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
              }
            });

            stream.on("close", () => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send("\r\n\x1b[33mSession closed\x1b[0m\r\n");
              }
              cleanup();
            });

            ws.on("message", (raw) => {
              if (closed) return;
              const text =
                typeof raw === "string" ? raw : raw.toString("utf8");

              // JSON control messages (resize)
              if (text.startsWith("{")) {
                try {
                  const msg = JSON.parse(text) as ResizeMessage;
                  if (
                    msg.type === "resize" &&
                    Number.isFinite(msg.cols) &&
                    Number.isFinite(msg.rows)
                  ) {
                    stream.setWindow(msg.rows, msg.cols, 0, 0);
                    return;
                  }
                } catch {
                  // treat as terminal input
                }
              }

              stream.write(text);
            });
          },
        );
      })
      .on("error", (err) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`\r\n\x1b[31mSSH error: ${err.message}\x1b[0m\r\n`);
        }
        cleanup();
      })
      .connect(connectConfig(cfg));
  });

  server.listen(port, hostname, () => {
    console.log(`> Server Manager ready on http://${hostname}:${port}`);
    // Start reliability watchdog after HTTP is up
    import("./lib/watchdog")
      .then(({ startWatchdog }) => startWatchdog())
      .catch((err) => console.error("> Watchdog failed to start", err));
  });
});