import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const PLUGIN_SECRET = process.env.PLUGIN_SECRET ?? "changeme";

function makePool() {
  const u = new URL(process.env.POSTGRES_URL ?? "");
  return new Pool({
    host: u.hostname,
    port: u.port ? parseInt(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false },
  });
}

export async function POST(req: NextRequest) {
  if (req.headers.get("x-plugin-secret") !== PLUGIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { mapImage } = await req.json();
  if (!mapImage || typeof mapImage !== "string") {
    return NextResponse.json({ error: "Missing mapImage" }, { status: 400 });
  }

  const pool = makePool();
  try {
    await pool.query(
      `UPDATE wipes SET map_image = $1 WHERE is_current = TRUE`,
      [mapImage]
    );
    return NextResponse.json({ ok: true });
  } finally {
    await pool.end();
  }
}
