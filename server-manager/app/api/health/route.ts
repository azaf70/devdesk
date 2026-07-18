import { NextResponse } from "next/server";
import { getWatchdogSnapshot, runWatchdogOnce } from "@/lib/watchdog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, ...getWatchdogSnapshot() });
}

export async function POST() {
  const snapshot = await runWatchdogOnce();
  return NextResponse.json({ ok: true, ...snapshot });
}
