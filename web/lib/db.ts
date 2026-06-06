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

// Self-healing migration for player economy columns (money / RP).
let playerEcoColsEnsured = false;
export async function ensurePlayerEconomyColumns(): Promise<void> {
  if (playerEcoColsEnsured) return;
  await exec(`ALTER TABLE players ADD COLUMN IF NOT EXISTS money REAL NOT NULL DEFAULT 0`);
  await exec(`ALTER TABLE players ADD COLUMN IF NOT EXISTS rp INTEGER NOT NULL DEFAULT 0`);
  playerEcoColsEnsured = true;
}

export async function updateBalances(
  balances: Array<{ steamId: string; money?: number; rp?: number }>
): Promise<void> {
  if (!balances || balances.length === 0) return;
  await ensurePlayerEconomyColumns();
  for (const b of balances) {
    if (!b.steamId) continue;
    await exec(
      `INSERT INTO players (steam_id, display_name, money, rp) VALUES ($1, $1, $2, $3)
       ON CONFLICT (steam_id) DO UPDATE SET money = EXCLUDED.money, rp = EXCLUDED.rp`,
      [b.steamId, Math.round(b.money ?? 0), Math.round(b.rp ?? 0)]
    );
  }
}

// Self-healing migration for the PvE stat columns so reads/writes work even if
// /api/setup hasn't been re-run after a deploy. Runs once per process.
let statColsEnsured = false;
export async function ensureStatColumns(): Promise<void> {
  if (statColsEnsured) return;
  for (const c of ["scientist_kills", "animal_kills", "heli_kills", "bradley_kills", "satchels", "boss_kills"]) {
    await exec(`ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS ${c} INTEGER NOT NULL DEFAULT 0`);
  }
  statColsEnsured = true;
}

// ── Schema ────────────────────────────────────────────────────────────────────
export async function initSchema() {
  await exec(`
    CREATE TABLE IF NOT EXISTS players (
      steam_id     TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      avatar_url   TEXT NOT NULL DEFAULT '',
      first_seen   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      last_seen    BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      money        REAL NOT NULL DEFAULT 0,
      rp           INTEGER NOT NULL DEFAULT 0
    )
  `);
  await exec(`ALTER TABLE players ADD COLUMN IF NOT EXISTS money REAL NOT NULL DEFAULT 0`);
  await exec(`ALTER TABLE players ADD COLUMN IF NOT EXISTS rp INTEGER NOT NULL DEFAULT 0`);
  await exec(`
    CREATE TABLE IF NOT EXISTS wipes (
      id         SERIAL PRIMARY KEY,
      started_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      map_seed   BIGINT,
      map_size   INTEGER,
      map_url    TEXT NOT NULL DEFAULT '',
      map_image  TEXT NOT NULL DEFAULT '',
      wipe_sig   TEXT,
      is_current BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  // Add columns to existing tables that were created before these fields existed
  await exec(`ALTER TABLE wipes ADD COLUMN IF NOT EXISTS map_image TEXT NOT NULL DEFAULT ''`);
  await exec(`ALTER TABLE wipes ADD COLUMN IF NOT EXISTS wipe_sig TEXT`);
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
      scientist_kills   INTEGER NOT NULL DEFAULT 0,
      animal_kills      INTEGER NOT NULL DEFAULT 0,
      heli_kills        INTEGER NOT NULL DEFAULT 0,
      bradley_kills     INTEGER NOT NULL DEFAULT 0,
      playtime          INTEGER NOT NULL DEFAULT 0,
      rating            INTEGER NOT NULL DEFAULT 0,
      UNIQUE(steam_id, wipe_id)
    )
  `);
  for (const c of ["scientist_kills", "animal_kills", "heli_kills", "bradley_kills", "satchels", "boss_kills"]) {
    await exec(`ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS ${c} INTEGER NOT NULL DEFAULT 0`);
  }
  await exec(`
    CREATE TABLE IF NOT EXISTS kill_log (
      id        SERIAL PRIMARY KEY,
      wipe_id   INTEGER NOT NULL REFERENCES wipes(id),
      killer_id TEXT REFERENCES players(steam_id),
      victim_id TEXT REFERENCES players(steam_id),
      weapon    TEXT NOT NULL DEFAULT '',
      headshot  BOOLEAN NOT NULL DEFAULT FALSE,
      x         REAL,
      z         REAL,
      ts        BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `);
  await exec(`ALTER TABLE kill_log ADD COLUMN IF NOT EXISTS x REAL`);
  await exec(`ALTER TABLE kill_log ADD COLUMN IF NOT EXISTS z REAL`);
  await exec(`
    CREATE TABLE IF NOT EXISTS live_state (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS population (
      ts     BIGINT PRIMARY KEY,
      online INTEGER NOT NULL
    )
  `);
  await exec(`CREATE INDEX IF NOT EXISTS idx_stats_wipe     ON player_stats(wipe_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_stats_rating   ON player_stats(wipe_id, rating DESC)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_kill_log_wipe  ON kill_log(wipe_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_kill_log_ts    ON kill_log(ts DESC)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_kill_log_killer ON kill_log(killer_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_kill_log_victim ON kill_log(victim_id)`);

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

// Idempotent wipe resolution by signature (seed_size_savetime). Starts a new
// wipe only when the signature changes, so retries/duplicate posts are safe.
let wipeSigColEnsured = false;
export async function resolveWipe(sig: string | undefined | null): Promise<number> {
  if (!sig) return getCurrentWipeId();

  if (!wipeSigColEnsured) {
    await exec(`ALTER TABLE wipes ADD COLUMN IF NOT EXISTS wipe_sig TEXT`);
    wipeSigColEnsured = true;
  }

  const cur = await query<{ id: number; wipe_sig: string | null }>(
    `SELECT id, wipe_sig FROM wipes WHERE is_current = TRUE LIMIT 1`
  );

  if (cur.length === 0) {
    const created = await query<{ id: number }>(
      `INSERT INTO wipes (is_current, wipe_sig) VALUES (TRUE, $1) RETURNING id`,
      [sig]
    );
    return created[0].id;
  }

  if (cur[0].wipe_sig === sig) return cur[0].id;

  // Signature changed → new wipe.
  await exec(`UPDATE wipes SET is_current = FALSE`);
  const created = await query<{ id: number }>(
    `INSERT INTO wipes (is_current, wipe_sig) VALUES (TRUE, $1) RETURNING id`,
    [sig]
  );
  return created[0].id;
}

// ── Map image ───────────────────────────────────────────────────────────────
// Stores the plugin's rendered map (base64 JPEG) on the current wipe. Self-heals
// if the column or current-wipe row is missing (older schemas).
export async function setCurrentMapImage(base64: string): Promise<void> {
  await exec(
    `CREATE TABLE IF NOT EXISTS wipes (
       id         SERIAL PRIMARY KEY,
       started_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
       map_seed   BIGINT,
       map_size   INTEGER,
       map_url    TEXT NOT NULL DEFAULT '',
       map_image  TEXT NOT NULL DEFAULT '',
       is_current BOOLEAN NOT NULL DEFAULT TRUE
     )`
  );
  await exec(`ALTER TABLE wipes ADD COLUMN IF NOT EXISTS map_image TEXT NOT NULL DEFAULT ''`);
  const rows = await query(`SELECT id FROM wipes WHERE is_current = TRUE LIMIT 1`);
  if (rows.length === 0) {
    await exec(`INSERT INTO wipes (is_current, map_image) VALUES (TRUE, $1)`, [base64]);
  } else {
    await exec(`UPDATE wipes SET map_image = $1 WHERE is_current = TRUE`, [base64]);
  }
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

// Persist fetched Steam avatars (only fills empty ones so we don't re-fetch).
export async function saveAvatars(avatars: Record<string, string>) {
  for (const [steamId, url] of Object.entries(avatars)) {
    if (!url) continue;
    await exec(
      `UPDATE players SET avatar_url = $1
       WHERE steam_id = $2 AND (avatar_url IS NULL OR avatar_url = '')`,
      [url, steamId]
    );
  }
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
    structuresPlaced?: number; rocketsFired?: number; c4Thrown?: number; satchels?: number;
    npcKills?: number; heliHits?: number; bradleyHits?: number; playtime?: number;
    scientistKills?: number; animalKills?: number; heliKills?: number; bradleyKills?: number;
    bossKills?: number;
  }
) {
  await ensureStatColumns();
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
       playtime          = playtime          + $14,
       scientist_kills   = scientist_kills   + $15,
       animal_kills      = animal_kills      + $16,
       heli_kills        = heli_kills        + $17,
       bradley_kills     = bradley_kills     + $18,
       satchels          = satchels          + $19,
       boss_kills        = boss_kills        + $20
     WHERE steam_id = $21 AND wipe_id = $22`,
    [
      n(d.kills), n(d.deaths), n(d.headshots),
      n(d.wood), n(d.stone), n(d.metalOre), n(d.sulfurOre),
      n(d.structuresPlaced), n(d.rocketsFired), n(d.c4Thrown),
      n(d.npcKills), n(d.heliHits), n(d.bradleyHits), n(d.playtime),
      n(d.scientistKills), n(d.animalKills), n(d.heliKills), n(d.bradleyKills),
      n(d.satchels), n(d.bossKills),
      steamId, wipeId,
    ]
  );
  // PvE-weighted rating: boss kills dominate, then NPC/scientist/hunting,
  // gathering, building, playtime. Minimal PvP weight.
  await exec(
    `UPDATE player_stats SET rating = GREATEST(0, (
       boss_kills * 100 + heli_kills * 50 + bradley_kills * 50 +
       scientist_kills * 3 + npc_kills * 2 + animal_kills * 1 +
       (wood + stone + metal_ore + sulfur_ore) / 1000 +
       structures_placed / 2 +
       (rockets_fired + c4_thrown + satchels) * 1 +
       playtime / 60 +
       kills * 2
     )) WHERE steam_id = $1 AND wipe_id = $2`,
    [steamId, wipeId]
  );
}

// ── Server totals (current wipe) ──────────────────────────────────────────────
export interface ServerTotals {
  players: number;
  npcKills: number;
  animalKills: number;
  bossKills: number;
  gathered: number;
  structures: number;
  playtime: number;
}

export async function getServerTotals(wipeId: number): Promise<ServerTotals> {
  await ensureStatColumns();
  const rows = await query<Record<string, unknown>>(
    `SELECT
       COUNT(DISTINCT steam_id)                               AS players,
       COALESCE(SUM(scientist_kills + npc_kills), 0)          AS npc_kills,
       COALESCE(SUM(animal_kills), 0)                         AS animal_kills,
       COALESCE(SUM(heli_kills + bradley_kills), 0)           AS boss_kills,
       COALESCE(SUM(wood + stone + metal_ore + sulfur_ore),0) AS gathered,
       COALESCE(SUM(structures_placed), 0)                   AS structures,
       COALESCE(SUM(playtime), 0)                            AS playtime
     FROM player_stats WHERE wipe_id = $1`,
    [wipeId]
  );
  const r = rows[0] ?? {};
  return {
    players: Number(r.players ?? 0),
    npcKills: Number(r.npc_kills ?? 0),
    animalKills: Number(r.animal_kills ?? 0),
    bossKills: Number(r.boss_kills ?? 0),
    gathered: Number(r.gathered ?? 0),
    structures: Number(r.structures ?? 0),
    playtime: Number(r.playtime ?? 0),
  };
}

// ── Population history ────────────────────────────────────────────────────────
let lastPopWrite = 0;

export async function recordPopulationSample(online: number): Promise<void> {
  const now = Date.now();
  // Throttle per serverless instance — one sample every 5 minutes is plenty.
  if (now - lastPopWrite < 5 * 60 * 1000) return;
  lastPopWrite = now;
  await exec(
    `CREATE TABLE IF NOT EXISTS population (
       ts     BIGINT PRIMARY KEY,
       online INTEGER NOT NULL
     )`
  );
  await exec(
    `INSERT INTO population (ts, online) VALUES ($1, $2)
     ON CONFLICT (ts) DO NOTHING`,
    [Math.floor(now / 1000), online]
  );
}

export async function queryPopulation(
  sinceSeconds: number
): Promise<{ ts: number; online: number }[]> {
  const since = Math.floor(Date.now() / 1000) - sinceSeconds;
  try {
    return await query<{ ts: number; online: number }>(
      `SELECT ts, online FROM population WHERE ts >= $1 ORDER BY ts ASC`,
      [since]
    );
  } catch {
    return []; // table may not exist yet
  }
}

// ── Weapon breakdown (from kill_log) ──────────────────────────────────────────
export async function queryWeaponBreakdown(
  steamId: string,
  wipeId?: number,
  limit = 8
): Promise<{ weapon: string; kills: number }[]> {
  const params: unknown[] = [steamId];
  let filter = "";
  if (wipeId !== undefined) {
    filter = `AND wipe_id = $2`;
    params.push(wipeId);
  }
  params.push(limit);
  const limitParam = `$${params.length}`;
  const rows = await query<{ weapon: string; kills: string }>(
    `SELECT weapon, COUNT(*) AS kills
     FROM kill_log
     WHERE killer_id = $1 AND weapon <> '' ${filter}
     GROUP BY weapon
     ORDER BY COUNT(*) DESC
     LIMIT ${limitParam}`,
    params
  );
  return rows.map((r) => ({ weapon: r.weapon, kills: Number(r.kills) }));
}

// ── Player profile ────────────────────────────────────────────────────────────
const STAT_COLS = [
  "kills", "deaths", "headshots", "wood", "stone", "metal_ore", "sulfur_ore",
  "structures_placed", "rockets_fired", "c4_thrown", "satchels", "npc_kills",
  "heli_hits", "bradley_hits", "scientist_kills", "animal_kills",
  "heli_kills", "bradley_kills", "boss_kills", "playtime", "rating",
] as const;

export type StatTotals = Record<(typeof STAT_COLS)[number], number>;

export interface PlayerProfile {
  player: {
    steam_id: string;
    display_name: string;
    avatar_url: string;
    first_seen: number;
    last_seen: number;
    money: number;
    rp: number;
  } | null;
  current: StatTotals;
  lifetime: StatTotals;
  weaponsCurrent: { weapon: string; kills: number }[];
  weaponsLifetime: { weapon: string; kills: number }[];
}

function emptyTotals(): StatTotals {
  return Object.fromEntries(STAT_COLS.map((c) => [c, 0])) as StatTotals;
}

function coerceTotals(row: Record<string, unknown> | undefined): StatTotals {
  const out = emptyTotals();
  if (!row) return out;
  for (const c of STAT_COLS) out[c] = Number(row[c] ?? 0);
  return out;
}

export async function getPlayerProfile(steamId: string): Promise<PlayerProfile> {
  await ensureStatColumns();
  await ensurePlayerEconomyColumns();
  const wipeId = await getCurrentWipeId();
  const sumExpr = STAT_COLS.map((c) => `COALESCE(SUM(${c}),0) AS ${c}`).join(", ");

  const [players, current, lifetime, weaponsCurrent, weaponsLifetime] = await Promise.all([
    query<PlayerProfile["player"]>(
      `SELECT steam_id, display_name, avatar_url, first_seen, last_seen, money, rp
       FROM players WHERE steam_id = $1`,
      [steamId]
    ),
    query<Record<string, unknown>>(
      `SELECT ${STAT_COLS.join(", ")} FROM player_stats WHERE steam_id = $1 AND wipe_id = $2`,
      [steamId, wipeId]
    ),
    query<Record<string, unknown>>(
      `SELECT ${sumExpr} FROM player_stats WHERE steam_id = $1`,
      [steamId]
    ),
    queryWeaponBreakdown(steamId, wipeId),
    queryWeaponBreakdown(steamId),
  ]);

  return {
    player: players[0] ?? null,
    current: coerceTotals(current[0]),
    lifetime: coerceTotals(lifetime[0]),
    weaponsCurrent,
    weaponsLifetime,
  };
}

// ── Kill feed ───────────────────────────────────────────────────────────────
export interface KillRow {
  id: number;
  weapon: string;
  headshot: boolean;
  ts: number;
  x: number | null;
  z: number | null;
  killer_id: string | null;
  killer_name: string | null;
  killer_avatar: string | null;
  victim_id: string | null;
  victim_name: string | null;
  victim_avatar: string | null;
}

export async function queryRecentKills(opts: {
  wipeId?: number; // omit for lifetime
  steamId?: string; // filter to kills involving this player
  sinceSeconds?: number; // only kills within the last N seconds
  limit: number;
}): Promise<KillRow[]> {
  const params: unknown[] = [];
  let i = 1;
  const where: string[] = [];
  if (opts.wipeId !== undefined) {
    where.push(`k.wipe_id = $${i++}`);
    params.push(opts.wipeId);
  }
  if (opts.steamId) {
    where.push(`(k.killer_id = $${i} OR k.victim_id = $${i})`);
    params.push(opts.steamId);
    i++;
  }
  if (opts.sinceSeconds) {
    where.push(`k.ts >= $${i++}`);
    params.push(Math.floor(Date.now() / 1000) - opts.sinceSeconds);
  }
  params.push(opts.limit);
  const limitParam = `$${i}`;

  return query<KillRow>(
    `SELECT k.id, k.weapon, k.headshot, k.ts, k.x, k.z,
            k.killer_id, ka.display_name AS killer_name, ka.avatar_url AS killer_avatar,
            k.victim_id, va.display_name AS victim_name, va.avatar_url AS victim_avatar
     FROM kill_log k
     LEFT JOIN players ka ON ka.steam_id = k.killer_id
     LEFT JOIN players va ON va.steam_id = k.victim_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY k.ts DESC, k.id DESC
     LIMIT ${limitParam}`,
    params
  );
}

// Self-healing batch insert for kills (ensures x/z columns exist once).
let killColsEnsured = false;
export async function recordKills(
  wipeId: number,
  kills: Array<{
    killerId?: string | null;
    victimId?: string | null;
    weapon?: string;
    headshot?: boolean;
    timestamp?: number;
    x?: number;
    z?: number;
  }>
): Promise<void> {
  if (kills.length === 0) return;
  if (!killColsEnsured) {
    await exec(`ALTER TABLE kill_log ADD COLUMN IF NOT EXISTS x REAL`);
    await exec(`ALTER TABLE kill_log ADD COLUMN IF NOT EXISTS z REAL`);
    killColsEnsured = true;
  }

  // Ensure killer/victim rows exist so the FK doesn't reject the insert.
  const ids = new Set<string>();
  for (const k of kills) {
    if (k.killerId) ids.add(k.killerId);
    if (k.victimId) ids.add(k.victimId);
  }
  for (const id of ids) {
    await exec(
      `INSERT INTO players (steam_id, display_name) VALUES ($1, $1)
       ON CONFLICT (steam_id) DO NOTHING`,
      [id]
    );
  }

  for (const k of kills) {
    await exec(
      `INSERT INTO kill_log (wipe_id, killer_id, victim_id, weapon, headshot, x, z, ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        wipeId,
        k.killerId ?? null,
        k.victimId ?? null,
        k.weapon ?? "",
        k.headshot ?? false,
        k.x ?? null,
        k.z ?? null,
        k.timestamp ?? Math.floor(Date.now() / 1000),
      ]
    );
  }
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
const ORDER_BY: Record<string, string> = {
  overall:    "SUM(s.rating) DESC",
  boss:       "SUM(s.boss_kills) DESC",
  npc:        "SUM(s.scientist_kills + s.npc_kills) DESC",
  hunting:    "SUM(s.animal_kills) DESC",
  events:     "SUM(s.heli_kills + s.bradley_kills) DESC",
  gathering:  "SUM(s.wood + s.stone + s.metal_ore + s.sulfur_ore) DESC",
  building:   "SUM(s.structures_placed) DESC",
  explosives: "SUM(s.rockets_fired + s.c4_thrown + s.satchels) DESC",
};

export async function queryLeaderboard(opts: {
  category: string;
  wipeId: number;
  wipeScope: "current" | "lifetime";
  search: string;
  limit: number;
}) {
  await ensureStatColumns();
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
       SUM(s.satchels)          AS satchels,
       SUM(s.npc_kills)         AS npc_kills,
       SUM(s.heli_hits)         AS heli_hits,
       SUM(s.bradley_hits)      AS bradley_hits,
       SUM(s.scientist_kills)   AS scientist_kills,
       SUM(s.animal_kills)      AS animal_kills,
       SUM(s.heli_kills)        AS heli_kills,
       SUM(s.bradley_kills)     AS bradley_kills,
       SUM(s.boss_kills)        AS boss_kills,
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
