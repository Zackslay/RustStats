import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getGameState } from "@/lib/gameState";

export const dynamic = "force-dynamic";

export async function GET() {
  const [state, wipeResult] = await Promise.all([
    getGameState(),
    sql`SELECT * FROM wipes WHERE is_current = TRUE LIMIT 1`,
  ]);

  return NextResponse.json({
    ...state,
    wipe: wipeResult.rows[0] ?? null,
  });
}
