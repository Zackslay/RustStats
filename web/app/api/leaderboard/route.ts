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

  // Postgres returns SUM()/BIGINT columns as strings — coerce stat fields to
  // numbers so the client can do arithmetic / .toFixed() without crashing.
  const NUM_FIELDS = [
    "kills", "deaths", "headshots", "wood", "stone", "metal_ore", "sulfur_ore",
    "structures_placed", "rockets_fired", "c4_thrown", "npc_kills",
    "heli_hits", "bradley_hits", "playtime", "rating",
  ];
  const players = rows.map((r, i) => {
    const out: Record<string, unknown> = { rank: i + 1, ...r };
    for (const f of NUM_FIELDS) out[f] = Number(out[f] ?? 0);
    return out;
  });

  return NextResponse.json({ category, wipeScope, players });
}
