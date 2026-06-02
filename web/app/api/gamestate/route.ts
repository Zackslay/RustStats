import { NextResponse } from "next/server";
import { Pool } from "pg";
import { getGameState } from "@/lib/gameState";

export const dynamic = "force-dynamic";

export async function GET() {
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL,
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
