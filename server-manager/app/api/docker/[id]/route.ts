import { NextRequest, NextResponse } from "next/server";
import { sshExec } from "@/lib/ssh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["start", "stop", "restart", "logs"]);

function sanitizeId(id: string): string | null {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id)) return null;
  return id;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const id = sanitizeId(rawId);
  if (!id) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  let body: { action?: string; tail?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }

  const action = body.action;
  if (!action || !ACTIONS.has(action)) {
    return NextResponse.json(
      { ok: false, error: "action must be start|stop|restart|logs" },
      { status: 400 },
    );
  }

  try {
    if (action === "logs") {
      const tail = Math.min(Math.max(Number(body.tail) || 100, 1), 500);
      const { stdout, stderr, code } = await sshExec(
        `docker logs --tail ${tail} ${id} 2>&1`,
      );
      return NextResponse.json({
        ok: code === 0,
        logs: stdout || stderr,
        error: code === 0 ? undefined : stderr || "logs failed",
      });
    }

    const { stdout, stderr, code } = await sshExec(
      `docker ${action} ${id} 2>&1`,
    );
    if (code !== 0) {
      return NextResponse.json(
        { ok: false, error: stderr || stdout || `${action} failed` },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, output: stdout || stderr });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SSH failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
