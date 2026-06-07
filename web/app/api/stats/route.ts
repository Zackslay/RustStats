import { NextResponse } from "next/server";
import { getCurrentWipeId, getServerTotals } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const wipeId = await getCurrentWipeId();
  const totals = await getServerTotals(wipeId);
  const res = NextResponse.json(totals);
  res.headers.set("CDN-Cache-Control", "public, s-maxage=15, stale-while-revalidate=60");
  return res;
}
