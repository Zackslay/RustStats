import { NextRequest, NextResponse } from "next/server";
import { getCurrentWipeId, queryLeaderboard } from "@/lib/db";

export const dynamic = "force-dynamic";

type Category = "overall" | "pvp" | "gathering" | "explosives" | "building" | "npc";
type WipeScope = "current" | "lifetime";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = (searchParams.get("category") ?? "overall") as Category;
  const wipeScope = (searchParams.get("wipe") ?? "current") as WipeScope;
  const search = searchParams.get("search") ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

  const wipeId = await getCurrentWipeId();

  const rows = await queryLeaderboard({ category, wipeId, wipeScope, search, limit });
  const players = rows.map((r, i) => ({ rank: i + 1, ...r }));

  return NextResponse.json({ category, wipeScope, players });
}
