import { NextRequest, NextResponse } from "next/server";
import { getCurrentWipeId, queryRecentKills } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 25), 200);
  const scope = searchParams.get("wipe") ?? "current"; // current | lifetime
  const steamId = searchParams.get("steamId") ?? undefined;
  const since = searchParams.get("since");
  const sinceSeconds = since ? Number(since) : undefined;

  const wipeId = scope === "lifetime" ? undefined : await getCurrentWipeId();
  const kills = await queryRecentKills({ wipeId, steamId, sinceSeconds, limit });

  return NextResponse.json({ kills });
}
