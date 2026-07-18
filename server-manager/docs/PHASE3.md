# Phase 3 — deferred

Coolify **write** control, Hetzner Cloud API, and MCP wrapping of **Server Manager** are **intentionally not built yet**.

## Cost rule (applies now and in Phase 3)

Stay on free tiers. Budget for *new* cloud add-ons: **$0 preferred, a couple of USD/month absolute max**. Do not enable paid Cloudflare products, Infrequent Access R2, extra Hetzner volumes/snapshots, or SaaS ops tools without explicit approval. See [INVENTORY.md](../INVENTORY.md) → Cost budget.

## What is already OK in Phase 2 (not Phase 3)

| Allowed early | Why |
|---------------|-----|
| Cursor Coolify MCP with `COOLIFY_READONLY=true` | Free; inventory/list only; no Server Manager surface |
| Cloudflare R2 Standard free tier for backups | Free under 10 GB / ops limits |
| Coolify API enabled (read token) for that MCP | Self-hosted; no Coolify Cloud bill |

## Why Phase 3 stays deferred

Phase 2 must be boring first:

1. Watchdog alerts you when URLs/host thresholds fail
2. Backups produce dumps you can restore (R2 `UPLOADED_S3` verified)
3. Playbooks cover the incidents you actually hit

Until that has run for about **one stable week**, adding write control-plane APIs only creates more surface area (and risk of spinning paid resources) without more recovery muscle.

## When to start Phase 3

- [ ] Telegram (or equivalent) alerted you on a real or test outage
- [x] At least one off-box backup exists (`UPLOADED_S3` — 2026-07-18)
- [ ] You completed a restore drill (see [RESTORE_DRILL.md](RESTORE_DRILL.md) / Playbooks → Restore DB)
- [ ] You can explain every Watchdog alert without guessing

Then implement, in order (still prefer free / no new billable resources):

1. Coolify API — list/restart/deploy apps from **Server Manager** (reuse read token; keep write token tightly scoped)
2. Hetzner API — only if needed; avoid auto-snapshots that accrue cost
3. MCP — wrap the same Server Manager actions for Cursor agents (separate from read-only Coolify MCP)
