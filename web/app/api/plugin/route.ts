import { NextRequest, NextResponse } from "next/server";
import {
  getGameState,
  updateGameState,
  mergePlayers,
  type ActiveEvent,
  type PlayerPosition,
} from "@/lib/gameState";
import {
  getCurrentWipeId,
  startNewWipe,
  upsertPlayer,
  upsertStats,
  applyStatDelta,
} from "@/lib/db";

const PLUGIN_SECRET = process.env.PLUGIN_SECRET ?? "changeme";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-plugin-secret") !== PLUGIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const wipeId = await getCurrentWipeId();

  // ── New wipe signal (do first so wipeId is fresh for everything else) ─────
  let activeWipeId = wipeId;
  if (body.newWipe) {
    activeWipeId = await startNewWipe();
  }

  // ── Server info ────────────────────────────────────────────────────────────
  if (body.server) {
    await updateGameState({ server: body.server });

    const s = body.server as { mapSeed?: number; mapSize?: number; mapUrl?: string };
    if (s.mapSeed || s.mapUrl) {
      const { Pool } = await import("pg");
      const u = new URL(process.env.POSTGRES_URL ?? ""); const pool = new Pool({ host: u.hostname, port: u.port ? parseInt(u.port) : 5432, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.replace(/^\//, ""), ssl: { rejectUnauthorized: false } });
      await pool.query(
        `UPDATE wipes SET
           map_seed = COALESCE($1, map_seed),
           map_size = COALESCE($2, map_size),
           map_url  = CASE WHEN $3 <> '' THEN $3 ELSE map_url END
         WHERE is_current = TRUE`,
        [s.mapSeed ?? null, s.mapSize ?? null, s.mapUrl ?? ""]
      );
      await pool.end();
    }
  }

  // ── Player positions ───────────────────────────────────────────────────────
  if (Array.isArray(body.players)) {
    const positions: Record<string, PlayerPosition> = {};
    await Promise.all(
      (body.players as PlayerPosition[]).map(async (p) => {
        positions[p.steamId] = p;
        if (p.online) {
          await upsertPlayer(p.steamId, p.name);
          await upsertStats(p.steamId, activeWipeId);
        }
      })
    );
    await mergePlayers(positions);
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  if (Array.isArray(body.events)) {
    const current = await getGameState();
    await updateGameState({ ...current, events: body.events as ActiveEvent[] });
  }

  // ── Stat deltas ─────────────────────────────────────────────────────────────
  if (Array.isArray(body.statDeltas)) {
    await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (body.statDeltas as any[]).map(async (d) => {
        await upsertPlayer(d.steamId, d.name ?? d.steamId);
        await upsertStats(d.steamId, activeWipeId);
        await applyStatDelta(d.steamId, activeWipeId, {
          kills: d.kills, deaths: d.deaths, headshots: d.headshots,
          wood: d.wood, stone: d.stone, metalOre: d.metalOre, sulfurOre: d.sulfurOre,
          structuresPlaced: d.structuresPlaced, rocketsFired: d.rocketsFired,
          c4Thrown: d.c4Thrown, npcKills: d.npcKills,
          heliHits: d.heliHits, bradleyHits: d.bradleyHits, playtime: d.playtime,
        });
      })
    );
  }

  // ── Kill log ───────────────────────────────────────────────────────────────
  if (Array.isArray(body.kills)) {
    await Promise.all(
      (body.kills as Array<{
        killerId: string; victimId: string; weapon: string;
        headshot: boolean; timestamp?: number;
      }>).map(async (k) => {
        const { Pool } = await import("pg");
        const u = new URL(process.env.POSTGRES_URL ?? ""); const pool = new Pool({ host: u.hostname, port: u.port ? parseInt(u.port) : 5432, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.replace(/^\//, ""), ssl: { rejectUnauthorized: false } });
        await pool.query(
          `INSERT INTO kill_log (wipe_id, killer_id, victim_id, weapon, headshot, ts)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [activeWipeId, k.killerId, k.victimId, k.weapon ?? "", k.headshot, k.timestamp ?? Math.floor(Date.now() / 1000)]
        );
        await pool.end();
      })
    );
  }

  return NextResponse.json({ ok: true });
}
