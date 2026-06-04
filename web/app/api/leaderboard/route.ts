import { NextRequest, NextResponse } from "next/server";
import { getCurrentWipeId, queryLeaderboard, saveAvatars } from "@/lib/db";
import { fetchSteamAvatars } from "@/lib/steam";

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
    "heli_hits", "bradley_hits", "scientist_kills", "animal_kills",
    "heli_kills", "bradley_kills", "playtime", "rating",
  ];
  const players = rows.map((r, i) => {
    const out: Record<string, unknown> = { rank: i + 1, ...r };
    for (const f of NUM_FIELDS) out[f] = Number(out[f] ?? 0);
    return out;
  });

  // Backfill Steam avatars for players missing one (cached in DB, so this only
  // fetches once per player). No-op without STEAM_API_KEY.
  const missing = players
    .filter((p) => !p.avatar_url)
    .map((p) => String(p.steam_id));
  if (missing.length > 0) {
    const avatars = await fetchSteamAvatars(missing);
    if (Object.keys(avatars).length > 0) {
      await saveAvatars(avatars);
      for (const p of players) {
        const url = avatars[String(p.steam_id)];
        if (url) p.avatar_url = url;
      }
    }
  }

  return NextResponse.json({ category, wipeScope, players });
}
