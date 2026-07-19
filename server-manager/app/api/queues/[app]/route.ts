import { NextRequest, NextResponse } from "next/server";
import { getQueueApp, runQueueAction, type QueueAction } from "@/lib/queues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set<QueueAction>(["retry", "flush", "restart", "failed"]);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ app: string }> },
) {
  const { app: rawApp } = await ctx.params;
  const app = getQueueApp(rawApp);
  if (!app) {
    return NextResponse.json(
      { ok: false, error: "Unknown app — must match a QUEUE_APPS id" },
      { status: 400 },
    );
  }

  let body: { action?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }

  const action = body.action as QueueAction | undefined;
  if (!action || !ACTIONS.has(action)) {
    return NextResponse.json(
      { ok: false, error: "action must be retry|flush|restart|failed" },
      { status: 400 },
    );
  }

  try {
    const result = await runQueueAction(app, action);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, output: result.output },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, output: result.output });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SSH failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
