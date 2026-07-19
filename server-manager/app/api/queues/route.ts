import { NextResponse } from "next/server";
import { fetchAllQueueStatuses, parseQueueApps } from "@/lib/queues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const configured = parseQueueApps();
    if (configured.length === 0) {
      return NextResponse.json({
        ok: true,
        apps: [],
        configured: [],
        warning:
          "No QUEUE_APPS configured. Format: id:labelKey=labelValue:Display Name",
      });
    }
    const apps = await fetchAllQueueStatuses();
    return NextResponse.json({
      ok: true,
      apps,
      configured: configured.map((c) => ({
        id: c.id,
        name: c.name,
        label: `${c.labelKey}=${c.labelValue}`,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SSH failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
