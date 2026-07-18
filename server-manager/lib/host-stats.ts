import { sshExec } from "./ssh";

export type HostStats = {
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

function parseMemKb(text: string, key: string): number | null {
  const re = new RegExp(`^${key}:\\s+(\\d+)`, "m");
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}

function section(stdout: string, name: string): string {
  const start = stdout.indexOf(`---${name}---`);
  if (start === -1) return "";
  const after = start + name.length + 6;
  const next = stdout.indexOf("---", after);
  return stdout.slice(after, next === -1 ? undefined : next).trim();
}

export function parseHostStatsStdout(stdout: string): HostStats {
  const uptimeSec = Number(section(stdout, "UPTIME").split(/\s+/)[0]) || 0;
  const loadParts = section(stdout, "LOAD").split(/\s+/);
  const mem = section(stdout, "MEM");
  const memTotal = parseMemKb(mem, "MemTotal");
  const memAvail =
    parseMemKb(mem, "MemAvailable") ?? parseMemKb(mem, "MemFree");
  const dfParts = section(stdout, "DF").split(/\s+/);
  const diskTotal = Number(dfParts[1]) || 0;
  const diskUsed = Number(dfParts[2]) || 0;
  const diskAvail = Number(dfParts[3]) || 0;

  return {
    host: section(stdout, "HOST") || process.env.SSH_HOST || "unknown",
    uname: section(stdout, "UNAME"),
    uptimeSec,
    load: {
      "1m": Number(loadParts[0]) || 0,
      "5m": Number(loadParts[1]) || 0,
      "15m": Number(loadParts[2]) || 0,
    },
    memory: {
      totalKb: memTotal,
      availableKb: memAvail,
      usedKb:
        memTotal != null && memAvail != null ? memTotal - memAvail : null,
    },
    disk: {
      totalBytes: diskTotal,
      usedBytes: diskUsed,
      availableBytes: diskAvail,
    },
    checkedAt: new Date().toISOString(),
  };
}

export async function fetchHostStats(): Promise<HostStats> {
  const script = [
    "echo '---UPTIME---'",
    "cat /proc/uptime",
    "echo '---LOAD---'",
    "cat /proc/loadavg",
    "echo '---MEM---'",
    "cat /proc/meminfo",
    "echo '---DF---'",
    "df -P -B1 / | tail -1",
    "echo '---HOST---'",
    "hostname",
    "echo '---UNAME---'",
    "uname -srm",
  ].join("; ");

  const { stdout, stderr, code } = await sshExec(script);
  if (code !== 0 && !stdout.includes("---UPTIME---")) {
    throw new Error(stderr || "Remote host stats failed");
  }
  return parseHostStatsStdout(stdout);
}

export function diskUsedPct(stats: HostStats): number {
  if (stats.disk.totalBytes <= 0) return 0;
  return Math.round((stats.disk.usedBytes / stats.disk.totalBytes) * 100);
}

export function memUsedPct(stats: HostStats): number {
  if (stats.memory.totalKb == null || stats.memory.usedKb == null) return 0;
  if (stats.memory.totalKb <= 0) return 0;
  return Math.round((stats.memory.usedKb / stats.memory.totalKb) * 100);
}
