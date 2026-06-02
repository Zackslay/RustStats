import { NextResponse } from "next/server";
import { Pool } from "pg";

export const dynamic = "force-dynamic";

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

export async function GET() {
  const pool = makePool();
  try {
    const res = await pool.query(
      `SELECT map_image FROM wipes WHERE is_current = TRUE LIMIT 1`
    );
    const base64 = res.rows[0]?.map_image;

    if (!base64) {
      return new NextResponse("Map not uploaded yet — plugin will upload on next server start", {
        status: 404,
      });
    }

    const bytes = Buffer.from(base64, "base64");
    const blob = new Blob([bytes], { type: "image/png" });

    return new NextResponse(blob, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } finally {
    await pool.end();
  }
}
