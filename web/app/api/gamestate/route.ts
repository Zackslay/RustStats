import { NextResponse } from "next/server";
import { Pool } from "pg";
import { getGameState } from "@/lib/gameState";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = new URL(process.env.POSTGRES_URL ?? "");
  const pool = new Pool({
    host: u.hostname,
    port: u.port ? parseInt(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false },
  });

  const [state, wipeRes] = await Promise.all([
    getGameState(),
    // NOT SELECT * — the wipes row holds the ~500KB base64 map_image, which
    // would be pulled from the DB on every poll (huge egress). Only the small
    // fields are needed here.
    pool.query(
      `SELECT id, started_at, map_seed, map_size, map_url, wipe_sig, is_current
       FROM wipes WHERE is_current = TRUE LIMIT 1`
    ),
  ]);
  await pool.end();

  const res = NextResponse.json({
    ...state,
    wipe: wipeRes.rows[0] ?? null,
  });
  // Edge-cache 2s so concurrent polls coalesce to ~1 DB read / 2s globally.
  res.headers.set("CDN-Cache-Control", "public, s-maxage=2, stale-while-revalidate=10");
  return res;
}
