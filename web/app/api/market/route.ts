import { NextResponse } from "next/server";
import { queryMarketTrends } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const trends = await queryMarketTrends();
  const res = NextResponse.json({ trends });
  res.headers.set("CDN-Cache-Control", "public, s-maxage=30, stale-while-revalidate=300");
  return res;
}
