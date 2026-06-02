import { NextRequest, NextResponse } from "next/server";
import { initSchema } from "@/lib/db";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-plugin-secret") !== (process.env.PLUGIN_SECRET ?? "changeme")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await initSchema();
    return NextResponse.json({ ok: true, message: "Schema initialized" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
