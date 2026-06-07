import { NextRequest, NextResponse } from "next/server";
import {
  getGameState,
  updateGameState,
  mergePlayers,
  setShops,
  type ActiveEvent,
  type PlayerPosition,
  type Shop,
} from "@/lib/gameState";
import { verifyPluginSecret } from "@/lib/pluginAuth";
import {
  getCurrentWipeId,
  startNewWipe,
  resolveWipe,
  upsertPlayer,
  upsertStats,
  applyStatDelta,
  recordKills,
  recordPopulationSample,
  updateBalances,
  recordHeatSamples,
} from "@/lib/db";

export async function POST(req: NextRequest) {
  const auth = verifyPluginSecret(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json();

  // ── Wipe resolution (do first so the right wipe id is used everywhere) ─────
  // Idempotent: starts a new wipe only when the map signature changes.
  const wipeSig = (body?.server as { wipeSig?: string } | undefined)?.wipeSig;
  let activeWipeId = wipeSig ? await resolveWipe(wipeSig) : await getCurrentWipeId();
  if (body.newWipe) {
    activeWipeId = await startNewWipe();
  }

  // ── Server info ────────────────────────────────────────────────────────────
  if (body.server) {
    // Monuments are sent only occasionally (perf) — preserve the last set when
    // this update omits them, so the map keeps its labels.
    const incoming = body.server as { monuments?: unknown[] };
    if (!incoming.monuments || incoming.monuments.length === 0) {
      const cur = await getGameState();
      incoming.monuments = cur.server?.monuments ?? [];
    }
    await updateGameState({ server: body.server });

    const s = body.server as {
      mapSeed?: number; mapSize?: number; mapUrl?: string; online?: number;
    };
    if (typeof s.online === "number") {
      await recordPopulationSample(s.online);
    }
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
    // A full live update (includes `server`) carries the complete online set,
    // so REPLACE players — otherwise disconnected players linger as "online".
    // A bare players push (e.g. OnPlayerConnected) just merges one in.
    if (body.server) {
      await updateGameState({ players: positions });
      // Sample online positions into the activity heatmap (throttled to ~60s).
      await recordHeatSamples(
        activeWipeId,
        Object.values(positions).filter((p) => p.online).map((p) => ({ x: p.x, z: p.z }))
      );
    } else {
      await mergePlayers(positions);
    }
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
          c4Thrown: d.c4Thrown, satchels: d.satchelsThrown, npcKills: d.npcKills,
          heliHits: d.heliHits, bradleyHits: d.bradleyHits, playtime: d.playtime,
          scientistKills: d.scientistKills, animalKills: d.animalKills,
          heliKills: d.heliKills, bradleyKills: d.bradleyKills, bossKills: d.bossKills,
        });
      })
    );
  }

  // ── Vending shops (sent occasionally; array present => replace) ───────────────
  if (Array.isArray(body.shops)) {
    await setShops(body.shops as Shop[]);
  }

  // ── Economy balances (money / RP) ────────────────────────────────────────────
  if (Array.isArray(body.balances)) {
    await updateBalances(
      body.balances as Array<{ steamId: string; money?: number; rp?: number }>
    );
  }

  // ── Kill log ───────────────────────────────────────────────────────────────
  if (Array.isArray(body.kills)) {
    await recordKills(
      activeWipeId,
      body.kills as Array<{
        killerId?: string; victimId?: string; weapon?: string;
        headshot?: boolean; timestamp?: number; x?: number; z?: number;
      }>
    );
  }

  return NextResponse.json({ ok: true });
}
