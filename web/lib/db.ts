import { Pool } from "pg";

// Parse POSTGRES_URL to get pooler host/user/port without letting the
// connection string's sslmode parameter override our ssl config.
function parsePoolConfig() {
  const raw = process.env.POSTGRES_URL ?? "";
  const u = new URL(raw);
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false },
    max: 3,
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function getPool(): Pool {
  if (!global.__pgPool) {
    global.__pgPool = new Pool(parsePoolConfig());
  }
  return global.__pgPool;
}

// Helper: run a query and return rows
async function query<T = Record<string, unknown>>(
  text: string,
  values?: unknown[]
): Promise<T[]> {
  const pool = getPool();
  const res = await pool.query(text, values);
  return res.rows as T[];
}

// Helper: run a statement (no return value needed)
async function exec(text: string, values?: unknown[]): Promise<void> {
  const pool = getPool();
  await pool.query(text, values);
}

// ── Schema ────────────────────────────────────────────────────────────────────
export async function initSchema() {
  await exec(`
    CREATE TABLE IF NOT EXISTS players (
      steam_id     TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      avatar_url   TEXT NOT NULL DEFAULT '',
      first_seen   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      last_seen    BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS wipes (
      id         SERIAL PRIMARY KEY,
      started_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      map_seed   BIGINT,
      map_size   INTEGER,
      map_url    TEXT NOT NULL DEFAULT '',
      map_image  TEXT NOT NULL DEFAULT '',
      is_current BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  // Add column to existing tables that were created before this field existed
  await exec(`ALTER TABLE wipes ADD COLUMN IF NOT EXISTS map_image TEXT NOT NULL DEFAULT ''`);
  await exec(`
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
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS kill_log (
      id        SERIAL PRIMARY KEY,
      wipe_id   INTEGER NOT NULL REFERENCES wipes(id),
      killer_id TEXT REFERENCES players(steam_id),
      victim_id TEXT REFERENCES players(steam_id),
      weapon    TEXT NOT NULL DEFAULT '',
      headshot  BOOLEAN NOT NULL DEFAULT FALSE,
      ts        BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS live_state (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await exec(`CREATE INDEX IF NOT EXISTS idx_stats_wipe    ON player_stats(wipe_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_stats_rating  ON player_stats(wipe_id, rating DESC)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_kill_log_wipe ON kill_log(wipe_id)`);

  const rows = await query(`SELECT id FROM wipes WHERE is_current = TRUE LIMIT 1`);
  if (rows.length === 0) {
    await exec(`INSERT INTO wipes (is_current) VALUES (TRUE)`);
  }
}

// ── Wipe helpers ──────────────────────────────────────────────────────────────
export async function getCurrentWipeId(): Promise<number> {
  const rows = await query<{ id: number }>(
    `SELECT id FROM wipes WHERE is_current = TRUE LIMIT 1`
  );
  if (rows.length === 0) {
    const created = await query<{ id: number }>(
      `INSERT INTO wipes (is_current) VALUES (TRUE) RETURNING id`
    );
    return created[0].id;
  }
  return rows[0].id;
}

export async function startNewWipe(): Promise<number> {
  await exec(`UPDATE wipes SET is_current = FALSE`);
  const rows = await query<{ id: number }>(
    `INSERT INTO wipes (is_current) VALUES (TRUE) RETURNING id`
  );
  return rows[0].id;
}

// ── Player / stat helpers ─────────────────────────────────────────────────────
export async function upsertPlayer(steamId: string, name: string, avatarUrl?: string) {
  await exec(
    `INSERT INTO players (steam_id, display_name, avatar_url)
     VALUES ($1, $2, $3)
     ON CONFLICT (steam_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       avatar_url   = CASE WHEN EXCLUDED.avatar_url <> '' THEN EXCLUDED.avatar_url ELSE players.avatar_url END,
       last_seen    = EXTRACT(EPOCH FROM NOW())::BIGINT`,
    [steamId, name, avatarUrl ?? ""]
  );
}

export async function upsertStats(steamId: string, wipeId: number) {
  await exec(
    `INSERT INTO player_stats (steam_id, wipe_id) VALUES ($1, $2)
     ON CONFLICT (steam_id, wipe_id) DO NOTHING`,
    [steamId, wipeId]
  );
}

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
  await exec(
    `UPDATE player_stats SET
       kills             = kills             + $1,
       deaths            = deaths            + $2,
       headshots         = headshots         + $3,
       wood              = wood              + $4,
       stone             = stone             + $5,
       metal_ore         = metal_ore         + $6,
       sulfur_ore        = sulfur_ore        + $7,
       structures_placed = structures_placed + $8,
       rockets_fired     = rockets_fired     + $9,
       c4_thrown         = c4_thrown         + $10,
       npc_kills         = npc_kills         + $11,
       heli_hits         = heli_hits         + $12,
       bradley_hits      = bradley_hits      + $13,
       playtime          = playtime          + $14
     WHERE steam_id = $15 AND wipe_id = $16`,
    [
      n(d.kills), n(d.deaths), n(d.headshots),
      n(d.wood), n(d.stone), n(d.metalOre), n(d.sulfurOre),
      n(d.structuresPlaced), n(d.rocketsFired), n(d.c4Thrown),
      n(d.npcKills), n(d.heliHits), n(d.bradleyHits), n(d.playtime),
      steamId, wipeId,
    ]
  );
  await exec(
    `UPDATE player_stats SET rating = GREATEST(0, (
       kills * 10 + headshots * 5 + npc_kills * 3 +
       heli_hits * 2 + bradley_hits * 2 +
       (wood + stone + metal_ore + sulfur_ore) / 1000 +
       structures_placed / 2 +
       rockets_fired * 4 + c4_thrown * 6 +
       playtime / 100 - deaths * 2
     )) WHERE steam_id = $1 AND wipe_id = $2`,
    [steamId, wipeId]
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
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
  const params: unknown[] = [];
  let paramIdx = 1;

  let wipeFilter = "";
  if (opts.wipeScope === "current") {
    wipeFilter = `AND s.wipe_id = $${paramIdx++}`;
    params.push(opts.wipeId);
  }

  let searchFilter = "";
  if (opts.search) {
    searchFilter = `AND p.display_name ILIKE $${paramIdx++}`;
    params.push(`%${opts.search}%`);
  }

  params.push(opts.limit);
  const limitParam = `$${paramIdx}`;

  return query(
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
}
