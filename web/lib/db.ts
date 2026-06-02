import { sql, db } from "@vercel/postgres";

// ── Schema ────────────────────────────────────────────────────────────────────
// Run once via POST /api/setup  (call it after first Vercel deploy)
export async function initSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS players (
      steam_id     TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      avatar_url   TEXT NOT NULL DEFAULT '',
      first_seen   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      last_seen    BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS wipes (
      id         SERIAL PRIMARY KEY,
      started_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      map_seed   BIGINT,
      map_size   INTEGER,
      map_url    TEXT NOT NULL DEFAULT '',
      is_current BOOLEAN NOT NULL DEFAULT TRUE
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS player_stats (
      id                SERIAL PRIMARY KEY,
      steam_id          TEXT NOT NULL REFERENCES players(steam_id),
      wipe_id           INTEGER NOT NULL REFERENCES wipes(id),
      kills             INTEGER NOT NULL DEFAULT 0,
      deaths            INTEGER NOT NULL DEFAULT 0,
      headshots         INTEGER NOT NULL DEFAULT 0,
      wood              INTEGER NOT NULL DEFAULT 0,
      stone             INTEGER NOT NULL DEFAULT 0,
      metal_ore         INTEGER NOT NULL DEFAULT 0,
      sulfur_ore        INTEGER NOT NULL DEFAULT 0,
      structures_placed INTEGER NOT NULL DEFAULT 0,
      rockets_fired     INTEGER NOT NULL DEFAULT 0,
      c4_thrown         INTEGER NOT NULL DEFAULT 0,
      npc_kills         INTEGER NOT NULL DEFAULT 0,
      heli_hits         INTEGER NOT NULL DEFAULT 0,
      bradley_hits      INTEGER NOT NULL DEFAULT 0,
      playtime          INTEGER NOT NULL DEFAULT 0,
      rating            INTEGER NOT NULL DEFAULT 0,
      UNIQUE(steam_id, wipe_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS kill_log (
      id        SERIAL PRIMARY KEY,
      wipe_id   INTEGER NOT NULL REFERENCES wipes(id),
      killer_id TEXT REFERENCES players(steam_id),
      victim_id TEXT REFERENCES players(steam_id),
      weapon    TEXT NOT NULL DEFAULT '',
      headshot  BOOLEAN NOT NULL DEFAULT FALSE,
      ts        BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `;

  // Single-row table for live game state (players, events, server info)
  await sql`
    CREATE TABLE IF NOT EXISTS live_state (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_stats_wipe   ON player_stats(wipe_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stats_rating ON player_stats(wipe_id, rating DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_kill_log_wipe ON kill_log(wipe_id)`;

  // Seed wipe row if none exists
  const { rows } = await sql`SELECT id FROM wipes WHERE is_current = TRUE LIMIT 1`;
  if (rows.length === 0) {
    await sql`INSERT INTO wipes (started_at, is_current) VALUES (EXTRACT(EPOCH FROM NOW())::BIGINT, TRUE)`;
  }
}

// ── Wipe helpers ──────────────────────────────────────────────────────────────
export async function getCurrentWipeId(): Promise<number> {
  const { rows } = await sql`SELECT id FROM wipes WHERE is_current = TRUE LIMIT 1`;
  if (rows.length === 0) {
    const { rows: created } = await sql`
      INSERT INTO wipes (started_at, is_current)
      VALUES (EXTRACT(EPOCH FROM NOW())::BIGINT, TRUE)
      RETURNING id
    `;
    return created[0].id as number;
  }
  return rows[0].id as number;
}

export async function startNewWipe(): Promise<number> {
  await sql`UPDATE wipes SET is_current = FALSE`;
  const { rows } = await sql`
    INSERT INTO wipes (started_at, is_current)
    VALUES (EXTRACT(EPOCH FROM NOW())::BIGINT, TRUE)
    RETURNING id
  `;
  return rows[0].id as number;
}

// ── Player / stat helpers ─────────────────────────────────────────────────────
export async function upsertPlayer(steamId: string, name: string, avatarUrl?: string) {
  await sql`
    INSERT INTO players (steam_id, display_name, avatar_url, first_seen, last_seen)
    VALUES (${steamId}, ${name}, ${avatarUrl ?? ""}, EXTRACT(EPOCH FROM NOW())::BIGINT, EXTRACT(EPOCH FROM NOW())::BIGINT)
    ON CONFLICT (steam_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      avatar_url   = CASE WHEN EXCLUDED.avatar_url <> '' THEN EXCLUDED.avatar_url ELSE players.avatar_url END,
      last_seen    = EXTRACT(EPOCH FROM NOW())::BIGINT
  `;
}

export async function upsertStats(steamId: string, wipeId: number) {
  await sql`
    INSERT INTO player_stats (steam_id, wipe_id)
    VALUES (${steamId}, ${wipeId})
    ON CONFLICT (steam_id, wipe_id) DO NOTHING
  `;
}

// Apply stat increments atomically
export async function applyStatDelta(
  steamId: string,
  wipeId: number,
  d: {
    kills?: number; deaths?: number; headshots?: number;
    wood?: number; stone?: number; metalOre?: number; sulfurOre?: number;
    structuresPlaced?: number; rocketsFired?: number; c4Thrown?: number;
    npcKills?: number; heliHits?: number; bradleyHits?: number; playtime?: number;
  }
) {
  const n = (v?: number) => v ?? 0;
  await sql`
    UPDATE player_stats SET
      kills             = kills             + ${n(d.kills)},
      deaths            = deaths            + ${n(d.deaths)},
      headshots         = headshots         + ${n(d.headshots)},
      wood              = wood              + ${n(d.wood)},
      stone             = stone             + ${n(d.stone)},
      metal_ore         = metal_ore         + ${n(d.metalOre)},
      sulfur_ore        = sulfur_ore        + ${n(d.sulfurOre)},
      structures_placed = structures_placed + ${n(d.structuresPlaced)},
      rockets_fired     = rockets_fired     + ${n(d.rocketsFired)},
      c4_thrown         = c4_thrown         + ${n(d.c4Thrown)},
      npc_kills         = npc_kills         + ${n(d.npcKills)},
      heli_hits         = heli_hits         + ${n(d.heliHits)},
      bradley_hits      = bradley_hits      + ${n(d.bradleyHits)},
      playtime          = playtime          + ${n(d.playtime)}
    WHERE steam_id = ${steamId} AND wipe_id = ${wipeId}
  `;
  await recomputeRating(steamId, wipeId);
}

async function recomputeRating(steamId: string, wipeId: number) {
  await sql`
    UPDATE player_stats SET rating = GREATEST(0, (
      kills * 10 + headshots * 5 + npc_kills * 3 +
      heli_hits * 2 + bradley_hits * 2 +
      (wood + stone + metal_ore + sulfur_ore) / 1000 +
      structures_placed / 2 +
      rockets_fired * 4 + c4_thrown * 6 +
      playtime / 100 -
      deaths * 2
    ))
    WHERE steam_id = ${steamId} AND wipe_id = ${wipeId}
  `;
}

// ── Dynamic leaderboard query ─────────────────────────────────────────────────
// ORDER BY is built from a trusted internal map — not user input.
const ORDER_BY: Record<string, string> = {
  overall:    "SUM(s.rating) DESC",
  pvp:        "SUM(s.kills) DESC, SUM(s.headshots) DESC",
  gathering:  "SUM(s.wood + s.stone + s.metal_ore + s.sulfur_ore) DESC",
  explosives: "SUM(s.rockets_fired + s.c4_thrown) DESC",
  building:   "SUM(s.structures_placed) DESC",
  npc:        "SUM(s.npc_kills + s.heli_hits + s.bradley_hits) DESC",
};

export async function queryLeaderboard(opts: {
  category: string;
  wipeId: number;
  wipeScope: "current" | "lifetime";
  search: string;
  limit: number;
}) {
  const orderBy = ORDER_BY[opts.category] ?? ORDER_BY.overall;
  const wipeFilter = opts.wipeScope === "current" ? `AND s.wipe_id = ${opts.wipeId}` : "";
  const searchFilter = opts.search ? `AND p.display_name ILIKE $1` : "";
  const searchParam = opts.search ? [`%${opts.search}%`] : [];

  const limitParam = opts.search ? `$2` : `$1`;
  const params = [...searchParam, opts.limit];

  const client = await db.connect();
  try {
    const { rows } = await client.query(
      `SELECT
         p.steam_id, p.display_name, p.avatar_url,
         SUM(s.kills)             AS kills,
         SUM(s.deaths)            AS deaths,
         SUM(s.headshots)         AS headshots,
         SUM(s.wood)              AS wood,
         SUM(s.stone)             AS stone,
         SUM(s.metal_ore)         AS metal_ore,
         SUM(s.sulfur_ore)        AS sulfur_ore,
         SUM(s.structures_placed) AS structures_placed,
         SUM(s.rockets_fired)     AS rockets_fired,
         SUM(s.c4_thrown)         AS c4_thrown,
         SUM(s.npc_kills)         AS npc_kills,
         SUM(s.heli_hits)         AS heli_hits,
         SUM(s.bradley_hits)      AS bradley_hits,
         SUM(s.playtime)          AS playtime,
         SUM(s.rating)            AS rating
       FROM player_stats s
       JOIN players p ON p.steam_id = s.steam_id
       WHERE 1=1 ${wipeFilter} ${searchFilter}
       GROUP BY p.steam_id, p.display_name, p.avatar_url
       ORDER BY ${orderBy}
       LIMIT ${limitParam}`,
      params
    );
    return rows;
  } finally {
    client.release();
  }
}
