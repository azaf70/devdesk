"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { StatsPanel } from "@/components/StatsPanel";
import { DockerPanel } from "@/components/DockerPanel";
import { WatchdogPanel } from "@/components/WatchdogPanel";
import { BackupPanel } from "@/components/BackupPanel";

const Terminal = dynamic(
  () => import("@/components/Terminal").then((m) => m.Terminal),
  {
    ssr: false,
    loading: () => (
      <section className="terminal-section">
        <header className="terminal-chrome">
          <h2>Live SSH</h2>
        </header>
        <div className="terminal-frame" />
      </section>
    ),
  },
);

export default function HomePage() {
  return (
    <div className="shell">
      <header className="brand-bar">
        <div className="brand-block">
          <p className="brand-name">Server Manager</p>
          <p className="brand-tag">
            Watchdog, backups, live SSH, and containers for your VPS.
          </p>
        </div>
        <div className="brand-actions">
          <Link href="/playbooks" className="btn btn-ghost">
            Playbooks
          </Link>
          <p className="brand-host mono">46.224.210.19</p>
        </div>
      </header>

      <div className="workspace">
        <div className="side-stack">
          <WatchdogPanel />
          <StatsPanel />
          <BackupPanel />
          <DockerPanel />
        </div>
        <Terminal />
      </div>
    </div>
  );
}
