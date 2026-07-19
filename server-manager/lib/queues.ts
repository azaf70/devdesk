import { sshExec } from "./ssh";

export type QueueAppConfig = {
  /** Stable key used in APIs / env (e.g. kinventory) */
  id: string;
  /** Docker label key, e.g. coolify.projectName */
  labelKey: string;
  /** Docker label value, e.g. kinventory */
  labelValue: string;
  /** Human display name */
  name: string;
};

export type QueueAppStatus = {
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

export type QueueAction = "retry" | "flush" | "restart" | "failed";

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * QUEUE_APPS format (comma-separated):
 *   id:labelKey=labelValue:Display Name
 * Example:
 *   kinventory:coolify.projectName=kinventory:KInventory
 */
export function parseQueueApps(raw = process.env.QUEUE_APPS ?? ""): QueueAppConfig[] {
  const out: QueueAppConfig[] = [];
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    // id:key=value:name  (name may contain spaces / colons after the 3rd segment)
    const firstColon = part.indexOf(":");
    if (firstColon <= 0) continue;
    const id = part.slice(0, firstColon).trim();
    const rest = part.slice(firstColon + 1);
    const eq = rest.indexOf("=");
    if (eq <= 0) continue;
    const labelKey = rest.slice(0, eq).trim();
    const afterEq = rest.slice(eq + 1);
    const secondColon = afterEq.indexOf(":");
    if (secondColon < 0) continue;
    const labelValue = afterEq.slice(0, secondColon).trim();
    const name = afterEq.slice(secondColon + 1).trim() || id;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id)) continue;
    if (!labelKey || !labelValue) continue;
    // Label key/value must be safe for docker --filter
    if (!/^[a-zA-Z0-9._-]+$/.test(labelKey)) continue;
    if (!/^[a-zA-Z0-9._-]+$/.test(labelValue)) continue;
    out.push({ id, labelKey, labelValue, name });
  }
  return out;
}

export function getQueueApp(id: string): QueueAppConfig | undefined {
  return parseQueueApps().find((a) => a.id === id);
}

/** Resolve artisan path for both Nixpacks (/app) and Dockerfile.prod (/var/www/html). */
function artisanResolveSnippet(): string {
  return `ARTISAN=""; if [ -f /var/www/html/artisan ]; then ARTISAN=/var/www/html/artisan; elif [ -f /app/artisan ]; then ARTISAN=/app/artisan; fi`;
}

async function resolveContainer(
  labelKey: string,
  labelValue: string,
): Promise<string | null> {
  const { stdout, code } = await sshExec(
    `docker ps --filter label=${shQuote(`${labelKey}=${labelValue}`)} --format '{{.ID}}' | head -1`,
  );
  if (code !== 0) return null;
  const id = stdout.trim().split("\n")[0]?.trim() || "";
  return id || null;
}

function parseCounts(raw: string): { pending: number; failed: number } | null {
  const line = raw
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line) return null;
  const m = line.match(/^(\d+)\|(\d+)$/);
  if (!m) return null;
  return { pending: Number(m[1]), failed: Number(m[2]) };
}

export async function fetchQueueAppStatus(
  app: QueueAppConfig,
): Promise<QueueAppStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const container = await resolveContainer(app.labelKey, app.labelValue);
    if (!container) {
      return {
        id: app.id,
        name: app.name,
        container: null,
        pending: null,
        failed: null,
        workerUp: null,
        queueDriver: null,
        error: `No running container with label ${app.labelKey}=${app.labelValue}`,
        checkedAt,
      };
    }

    // One docker exec: resolve artisan, count jobs, detect worker, peek queue driver
    const inner = [
      "set -e",
      artisanResolveSnippet(),
      'if [ -z "$ARTISAN" ]; then echo "NO_ARTISAN"; exit 0; fi',
      // Counts via tinker (Laravel 10+)
      `COUNTS=$(php "$ARTISAN" tinker --execute='echo DB::table("jobs")->count()."|".DB::table("failed_jobs")->count();' 2>/dev/null | tr -d "\\r" | tail -1 || true)`,
      'echo "COUNTS:$COUNTS"',
      // Worker process (busybox/alpine-friendly)
      'if ps aux 2>/dev/null | grep -E "[q]ueue:work" >/dev/null; then echo "WORKER:UP"; else echo "WORKER:DOWN"; fi',
      // Default queue connection name (best-effort)
      `DRIVER=$(php "$ARTISAN" tinker --execute='echo config("queue.default");' 2>/dev/null | tr -d "\\r" | tail -1 || true)`,
      'echo "DRIVER:${DRIVER:-unknown}"',
    ].join("; ");

    const { stdout, stderr, code } = await sshExec(
      `docker exec ${shQuote(container)} sh -c ${shQuote(inner)}`,
      60_000,
    );
    const text = [stdout, stderr].filter(Boolean).join("\n");

    if (text.includes("NO_ARTISAN")) {
      return {
        id: app.id,
        name: app.name,
        container,
        pending: null,
        failed: null,
        workerUp: null,
        queueDriver: null,
        error: "artisan not found at /var/www/html or /app",
        checkedAt,
      };
    }

    const countsLine =
      text
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("COUNTS:"))
        ?.slice("COUNTS:".length) ?? "";
    const counts = parseCounts(countsLine);
    const workerUp = text.includes("WORKER:UP")
      ? true
      : text.includes("WORKER:DOWN")
        ? false
        : null;
    const driver =
      text
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("DRIVER:"))
        ?.slice("DRIVER:".length) || null;

    if (code !== 0 && !counts) {
      return {
        id: app.id,
        name: app.name,
        container,
        pending: null,
        failed: null,
        workerUp,
        queueDriver: driver,
        error: stderr || stdout || `exit ${code}`,
        checkedAt,
      };
    }

    return {
      id: app.id,
      name: app.name,
      container,
      pending: counts?.pending ?? null,
      failed: counts?.failed ?? null,
      workerUp,
      queueDriver: driver,
      error: counts ? null : "Could not parse job counts (is QUEUE_CONNECTION=database?)",
      checkedAt,
    };
  } catch (err) {
    return {
      id: app.id,
      name: app.name,
      container: null,
      pending: null,
      failed: null,
      workerUp: null,
      queueDriver: null,
      error: err instanceof Error ? err.message : "queue check failed",
      checkedAt,
    };
  }
}

export async function fetchAllQueueStatuses(): Promise<QueueAppStatus[]> {
  const apps = parseQueueApps();
  if (apps.length === 0) return [];
  return Promise.all(apps.map(fetchQueueAppStatus));
}

export async function runQueueAction(
  app: QueueAppConfig,
  action: QueueAction,
): Promise<{ ok: boolean; output: string; error?: string }> {
  const container = await resolveContainer(app.labelKey, app.labelValue);
  if (!container) {
    return {
      ok: false,
      output: "",
      error: `No running container with label ${app.labelKey}=${app.labelValue}`,
    };
  }

  let artisanCmd: string;
  switch (action) {
    case "retry":
      artisanCmd = 'queue:retry all';
      break;
    case "flush":
      artisanCmd = "queue:flush";
      break;
    case "restart":
      artisanCmd = "queue:restart";
      break;
    case "failed":
      artisanCmd = "queue:failed";
      break;
    default:
      return { ok: false, output: "", error: "Unknown action" };
  }

  const inner = [
    artisanResolveSnippet(),
    'if [ -z "$ARTISAN" ]; then echo NO_ARTISAN; exit 1; fi',
    `php "$ARTISAN" ${artisanCmd}`,
  ].join("; ");

  try {
    const { stdout, stderr, code } = await sshExec(
      `docker exec ${shQuote(container)} sh -c ${shQuote(inner)}`,
      120_000,
    );
    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    if (code !== 0) {
      return {
        ok: false,
        output,
        error: stderr || stdout || `exit ${code}`,
      };
    }
    return { ok: true, output };
  } catch (err) {
    return {
      ok: false,
      output: "",
      error: err instanceof Error ? err.message : "action failed",
    };
  }
}
