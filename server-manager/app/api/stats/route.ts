import { NextResponse } from "next/server";
import { fetchHostStats } from "@/lib/host-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await fetchHostStats();
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SSH failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
