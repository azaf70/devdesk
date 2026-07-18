import { NextResponse } from "next/server";
import { sshExec } from "@/lib/ssh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type DockerContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
};

export async function GET() {
  try {
    const { stdout, stderr, code } = await sshExec(
      "docker ps -a --format '{{json .}}' 2>&1",
    );

    if (code !== 0) {
      return NextResponse.json(
        {
          ok: false,
          error: stderr || stdout || "docker ps failed",
        },
        { status: 502 },
      );
    }

    const lines = stdout
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const containers: DockerContainer[] = [];
    for (const line of lines) {
      try {
        const row = JSON.parse(line) as Record<string, string>;
        containers.push({
          id: row.ID ?? row.Id ?? "",
          name: (row.Names ?? row.Name ?? "").replace(/^\//, ""),
          image: row.Image ?? "",
          status: row.Status ?? "",
          state: row.State ?? "",
          ports: row.Ports ?? "",
        });
      } catch {
        // skip malformed
      }
    }

    return NextResponse.json({ ok: true, containers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SSH failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
