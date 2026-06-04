import { NextRequest, NextResponse } from "next/server";
import { queryPopulation } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const since = Math.min(Number(searchParams.get("since") ?? 86400), 7 * 86400);
  const points = await queryPopulation(since);
  const peak = points.reduce((m, p) => Math.max(m, p.online), 0);
  return NextResponse.json({ points, peak });
}
