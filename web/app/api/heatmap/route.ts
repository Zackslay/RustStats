import { NextRequest, NextResponse } from "next/server";
import { getCurrentWipeId, queryDeathPoints, queryActivityHeat } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "deaths"; // deaths | activity
  const scope = searchParams.get("wipe") ?? "current"; // current | lifetime
  const limit = Math.min(Number(searchParams.get("limit") ?? 4000), 8000);

  let points;
  if (type === "activity") {
    points = await queryActivityHeat(await getCurrentWipeId());
  } else {
    const wipeId = scope === "lifetime" ? undefined : await getCurrentWipeId();
    points = await queryDeathPoints(wipeId, limit);
  }

  const res = NextResponse.json({ points });
  res.headers.set("CDN-Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  return res;
}
