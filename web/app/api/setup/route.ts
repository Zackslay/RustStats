import { NextRequest, NextResponse } from "next/server";
import { initSchema } from "@/lib/db";

// Protected by the same plugin secret so it can't be called publicly.
// Run once after first deploy: curl -X POST https://your-app.vercel.app/api/setup \
//   -H "x-plugin-secret: <your-secret>"
export async function POST(req: NextRequest) {
  if (req.headers.get("x-plugin-secret") !== (process.env.PLUGIN_SECRET ?? "changeme")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await initSchema();
  return NextResponse.json({ ok: true, message: "Schema initialized" });
}
