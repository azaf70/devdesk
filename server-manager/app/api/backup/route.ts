import { NextResponse } from "next/server";
import { getBackupConfig, runBackup } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = getBackupConfig();
  return NextResponse.json({
    ok: true,
    remoteDir: cfg.remoteDir,
    targets: cfg.targets,
    keepDays: cfg.keepDays,
    s3Configured: cfg.s3Configured,
  });
}

export async function POST() {
  const result = await runBackup();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
