"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { StatsPanel } from "@/components/StatsPanel";
import { DockerPanel } from "@/components/DockerPanel";
import { WatchdogPanel } from "@/components/WatchdogPanel";
import { QueuePanel } from "@/components/QueuePanel";
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
  const [sshOpen, setSshOpen] = useState(false);
  const [sshMounted, setSshMounted] = useState(false);

  const openSsh = useCallback(() => {
    setSshMounted(true);
    setSshOpen(true);
  }, []);

  const closeSsh = useCallback(() => {
    setSshOpen(false);
  }, []);

  useEffect(() => {
    if (!sshOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSsh();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sshOpen, closeSsh]);

  useEffect(() => {
    document.body.style.overflow = sshOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sshOpen]);

  return (
    <div className="shell">
      <header className="brand-bar">
        <div className="brand-block">
          <p className="brand-name">Server Manager</p>
          <p className="brand-tag">
            Health, containers, and backups for your VPS.
          </p>
        </div>
        <div className="brand-actions">
          <Link href="/playbooks" className="btn btn-ghost">
            Playbooks
          </Link>
          <button type="button" className="btn btn-primary" onClick={openSsh}>
            Open SSH
          </button>
          <p className="brand-host mono">46.224.210.19</p>
        </div>
      </header>

      <div className="ops-layout">
        <StatsPanel />

        <div className="ops-grid">
          <WatchdogPanel />
          <DockerPanel />
        </div>

        <div className="ops-grid ops-grid-secondary">
          <QueuePanel />
          <BackupPanel />
        </div>
      </div>

      {sshMounted && (
        <div
          className={`ssh-overlay${sshOpen ? " is-open" : ""}`}
          aria-hidden={!sshOpen}
        >
          <button
            type="button"
            className="ssh-backdrop"
            aria-label="Close SSH"
            tabIndex={sshOpen ? 0 : -1}
            onClick={closeSsh}
          />
          <div
            className="ssh-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Live SSH"
          >
            <Terminal onClose={closeSsh} />
          </div>
        </div>
      )}
    </div>
  );
}
