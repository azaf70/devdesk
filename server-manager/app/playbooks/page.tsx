import Link from "next/link";

const PLAYBOOKS = [
  {
    id: "site-502",
    title: "Site returns 502 / gateway error",
    steps: [
      "Open Server Manager → Watchdog: confirm which URL is red.",
      "Open Containers: find the app container and Coolify proxy (`coolify-proxy` / Traefik).",
      "Click Logs on the app container — look for crash loops or DB connection errors.",
      "If the app is stopped: Start. If it’s running but broken: Restart.",
      "If proxy is unhealthy: Restart `coolify-proxy`, wait 30s, re-check the URL.",
      "Still down? Live SSH → `docker ps` and `curl -I https://your-domain` from the VPS.",
      "Update this playbook with what actually fixed it.",
    ],
  },
  {
    id: "disk-full",
    title: "Disk full / disk alert",
    steps: [
      "Watchdog host alert shows disk ≥ threshold (default 90%).",
      "Live SSH: `df -h` and `du -xh /var/lib/docker | sort -h | tail`.",
      "Safe reclaim: `docker system prune -f` (unused images/networks). Avoid `-a` until you know you can re-pull.",
      "Trim app/Coolify logs if huge: check `/var/lib/docker/containers`.",
      "Confirm `df -h` is under the alert threshold; Watchdog should flip to recovered.",
      "Schedule a Backup now once disk has headroom.",
    ],
  },
  {
    id: "ssh-ok-site-down",
    title: "SSH works but public site is down",
    steps: [
      "Terminal connects → host is up; problem is app/proxy/DNS.",
      "Containers: is Traefik/Coolify proxy Up? Are app containers Up?",
      "From the VPS: `curl -I http://127.0.0.1` and curl the public URL.",
      "Check Coolify UI (when available) for failed deploys or stopped resources.",
      "DNS: from your laptop `dig +short your-domain` should point at `46.224.210.19`.",
      "If only one app is down, restart that container; if all HTTPS fails, restart proxy.",
    ],
  },
  {
    id: "restore-db",
    title: "Restore DB from a dump (restore drill)",
    steps: [
      "Prerequisite: a successful Backup now (file on VPS under BACKUP_REMOTE_DIR).",
      "Pick a non-prod / staging DB first — never drill on production without a second copy.",
      "Live SSH: `ls -la /root/server-manager-backups` (or your BACKUP_REMOTE_DIR).",
      "For Postgres: `gunzip -c path/to/dump.sql.gz | docker exec -i CONTAINER psql -U postgres DBNAME`.",
      "For MySQL: `gunzip -c path/to/dump.sql.gz | docker exec -i CONTAINER mysql -uroot DBNAME`.",
      "Open the app and confirm data looks right.",
      "Write the exact commands you used below in INVENTORY.md notes.",
      "Only after a successful drill should you trust backups for real incidents.",
    ],
  },
  {
    id: "bad-deploy",
    title: "Bad deploy / app corrupt after update",
    steps: [
      "Stop taking new writes if the app is destructive (maintenance mode if you have it).",
      "Containers → Logs for the broken release; note the image/tag.",
      "In Coolify: redeploy previous known-good commit/image if available.",
      "If data was migrated badly: Restore DB playbook using the dump from before the deploy.",
      "Re-run Watchdog Check now; confirm Telegram recovered (if configured).",
      "Document root cause in this playbook.",
    ],
  },
  {
    id: "queue-worker",
    title: "Laravel queue worker down / jobs stuck",
    steps: [
      "Open Server Manager → Queues: which app shows worker down or failed > 0?",
      "Confirm Coolify env has QUEUE_CONNECTION=database (not sync).",
      "Confirm the app is on the GHCR Dockerfile.prod image (supervisord + queue-worker), not Nixpacks.",
      "Containers → Logs on that app — look for queue:work / supervisord errors.",
      "Queues panel → Restart (signals queue:restart). If still down, Restart the container.",
      "Failed jobs: list with Failed, then Retry all, or Flush if they are poison.",
      "Verify: docker exec into the container → supervisorctl status (queue-worker RUNNING).",
      "Full cutover steps: docs/QUEUES.md.",
    ],
  },
];

export default function PlaybooksPage() {
  return (
    <div className="shell playbooks-shell">
      <header className="brand-bar">
        <div className="brand-block">
          <p className="brand-name">Playbooks</p>
          <p className="brand-tag">
            Short checklists for when something breaks. Edit these after every
            real incident.
          </p>
        </div>
        <Link href="/" className="btn">
          ← Ops home
        </Link>
      </header>

      <div className="playbooks-list">
        {PLAYBOOKS.map((pb) => (
          <article className="playbook" key={pb.id} id={pb.id}>
            <h2>{pb.title}</h2>
            <ol>
              {pb.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </article>
        ))}
      </div>

      <p className="muted">
        Also keep{" "}
        <span className="mono">INVENTORY.md</span> updated with domains and DB
        names so these steps stay specific.
      </p>
    </div>
  );
}
