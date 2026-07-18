import { fetchHostStats, diskUsedPct, memUsedPct, HostStats } from "./host-stats";
import { sendTelegram } from "./telegram";

export type UrlCheck = {
  url: string;
  ok: boolean;
  status: number | null;
  error: string | null;
  latencyMs: number;
  checkedAt: string;
};

export type HostAlert = {
  key: string;
  ok: boolean;
  message: string;
};

export type WatchdogSnapshot = {
  urls: UrlCheck[];
  configuredUrls: string[];
  host: HostStats | null;
  hostError: string | null;
  hostAlerts: HostAlert[];
  lastRunAt: string | null;
  telegramConfigured: boolean;
  intervalMs: number;
};

type PrevUrl = { ok: boolean };
type PrevHost = Record<string, boolean>;

type WatchdogState = {
  snapshot: WatchdogSnapshot;
  prevUrls: Map<string, PrevUrl>;
  prevHost: PrevHost;
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
};

const globalKey = "__serverManagerWatchdog";

function getState(): WatchdogState {
  const g = globalThis as unknown as Record<string, WatchdogState | undefined>;
  if (!g[globalKey]) {
    g[globalKey] = {
      snapshot: {
        urls: [],
        configuredUrls: [],
        host: null,
        hostError: null,
        hostAlerts: [],
        lastRunAt: null,
        telegramConfigured: false,
        intervalMs: 60_000,
      },
      prevUrls: new Map(),
      prevHost: {},
      timer: null,
      running: false,
    };
  }
  return g[globalKey]!;
}

function getUrls(): string[] {
  const raw = process.env.WATCHDOG_URLS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function intervalMs(): number {
  const n = Number(process.env.WATCHDOG_INTERVAL_MS ?? "60000");
  return Number.isFinite(n) && n >= 15_000 ? n : 60_000;
}

function diskThreshold(): number {
  const raw = process.env.DISK_ALERT_PCT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 90;
}

function memThreshold(): number {
  const raw = process.env.MEM_ALERT_PCT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 90;
}

async function checkUrl(url: string): Promise<UrlCheck> {
  const started = Date.now();
  const checkedAt = new Date().toISOString();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "ServerManager-Watchdog/1.0" },
    });
    clearTimeout(t);
    const ok = res.status >= 200 && res.status < 400;
    return {
      url,
      ok,
      status: res.status,
      error: ok ? null : `HTTP ${res.status}`,
      latencyMs: Date.now() - started,
      checkedAt,
    };
  } catch (err) {
    return {
      url,
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : "fetch failed",
      latencyMs: Date.now() - started,
      checkedAt,
    };
  }
}

function buildHostAlerts(stats: HostStats): HostAlert[] {
  const alerts: HostAlert[] = [];
  const disk = diskUsedPct(stats);
  const mem = memUsedPct(stats);
  const diskLim = diskThreshold();
  const memLim = memThreshold();

  alerts.push({
    key: "disk",
    ok: disk < diskLim,
    message: `Disk ${disk}% used (alert ≥ ${diskLim}%)`,
  });
  alerts.push({
    key: "memory",
    ok: mem < memLim,
    message: `Memory ${mem}% used (alert ≥ ${memLim}%)`,
  });

  return alerts;
}

async function maybeAlertUrl(check: UrlCheck) {
  const state = getState();
  const prev = state.prevUrls.get(check.url);
  state.prevUrls.set(check.url, { ok: check.ok });
  if (prev && prev.ok === check.ok) return;
  if (!prev && check.ok) return;

  const label = check.ok ? "RECOVERED" : "DOWN";
  const detail = check.ok
    ? `HTTP ${check.status}`
    : check.error || `HTTP ${check.status}`;
  await sendTelegram(
    `[Server Manager] ${label}\n${check.url}\n${detail}\n${check.checkedAt}`,
  );
}

async function maybeAlertHost(alerts: HostAlert[]) {
  const state = getState();
  for (const a of alerts) {
    const prevOk = state.prevHost[a.key];
    state.prevHost[a.key] = a.ok;
    if (prevOk === undefined && a.ok) continue;
    if (prevOk === a.ok) continue;
    const label = a.ok ? "RECOVERED" : "ALERT";
    await sendTelegram(
      `[Server Manager] Host ${label}\n${a.message}\n${new Date().toISOString()}`,
    );
  }
}

export async function runWatchdogOnce(): Promise<WatchdogSnapshot> {
  const state = getState();
  const urls = getUrls();
  const urlResults = await Promise.all(urls.map(checkUrl));
  for (const c of urlResults) {
    await maybeAlertUrl(c);
  }

  let host: HostStats | null = null;
  let hostError: string | null = null;
  let hostAlerts: HostAlert[] = [];
  try {
    host = await fetchHostStats();
    hostAlerts = buildHostAlerts(host);
    await maybeAlertHost(hostAlerts);
  } catch (err) {
    hostError = err instanceof Error ? err.message : "host check failed";
    const sshAlert: HostAlert = {
      key: "ssh",
      ok: false,
      message: `SSH/host check failed: ${hostError}`,
    };
    hostAlerts = [sshAlert];
    await maybeAlertHost(hostAlerts);
  }

  state.snapshot = {
    urls: urlResults,
    configuredUrls: urls,
    host,
    hostError,
    hostAlerts,
    lastRunAt: new Date().toISOString(),
    telegramConfigured: Boolean(
      process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
    ),
    intervalMs: intervalMs(),
  };
  return state.snapshot;
}

export function getWatchdogSnapshot(): WatchdogSnapshot {
  const state = getState();
  return {
    ...state.snapshot,
    configuredUrls: getUrls(),
    telegramConfigured: Boolean(
      process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
    ),
    intervalMs: intervalMs(),
  };
}

export function startWatchdog() {
  const state = getState();
  if (state.running) return;
  state.running = true;
  const ms = intervalMs();
  state.snapshot.intervalMs = ms;
  console.log(`> Watchdog started (interval ${ms}ms, urls=${getUrls().length})`);
  void runWatchdogOnce().then((snap) => {
    console.log(
      `> Watchdog first run: ${snap.urls.length} urls, lastRun=${snap.lastRunAt}`,
    );
  });
  state.timer = setInterval(() => {
    void runWatchdogOnce();
  }, ms);
}

export function stopWatchdog() {
  const state = getState();
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.running = false;
}
