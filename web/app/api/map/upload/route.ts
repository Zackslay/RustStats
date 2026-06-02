import { NextRequest, NextResponse } from "next/server";
import { setCurrentMapImage } from "@/lib/db";

const PLUGIN_SECRET = process.env.PLUGIN_SECRET ?? "changeme";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-plugin-secret") !== PLUGIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let mapImage: unknown;
  try {
    ({ mapImage } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!mapImage || typeof mapImage !== "string") {
    return NextResponse.json({ error: "Missing mapImage" }, { status: 400 });
  }

  try {
    await setCurrentMapImage(mapImage);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[map/upload] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
