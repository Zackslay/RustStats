import { NextRequest, NextResponse } from "next/server";
import { getCurrentWipeId, queryDeathPoints } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("wipe") ?? "current"; // current | lifetime
  const limit = Math.min(Number(searchParams.get("limit") ?? 4000), 8000);
  // type reserved for future sources (deaths | activity); deaths for now.

  const wipeId = scope === "lifetime" ? undefined : await getCurrentWipeId();
  const points = await queryDeathPoints(wipeId, limit);

  const res = NextResponse.json({ points });
  res.headers.set("CDN-Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  return res;
}
