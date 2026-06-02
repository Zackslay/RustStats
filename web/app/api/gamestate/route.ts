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
    pool.query(`SELECT * FROM wipes WHERE is_current = TRUE LIMIT 1`),
  ]);
  await pool.end();

  return NextResponse.json({
    ...state,
    wipe: wipeRes.rows[0] ?? null,
  });
}
