import { Pool } from "pg";

export interface PlayerPosition {
  steamId: string;
  name: string;
  x: number;
  y: number;
  z: number;
  health: number;
  online: boolean;
  teamId?: number;
}

export interface ActiveEvent {
  type: "heli" | "bradley" | "cargo" | "chinook" | "boss";
  x: number;
  y: number;
  z: number;
  health?: number;
  label: string;
}

export interface ServerInfo {
  name: string;
  ip: string;
  port: number;
  online: number;
  maxPlayers: number;
  mapSeed: number;
  mapSize: number;
  mapUrl: string;
  wipeDate: number;
  updatedAt: number;
  monuments?: Monument[];
}

export interface Monument {
  name: string;
  x: number;
  z: number;
}

export interface GameState {
  server: ServerInfo | null;
  players: Record<string, PlayerPosition>;
  events: ActiveEvent[];
  lastUpdate: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

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

function getPool(): Pool {
  if (!global.__pgPool) {
    global.__pgPool = new Pool(parsePoolConfig());
  }
  return global.__pgPool;
}

const STATE_KEY = "game_state";

function makeInitial(): GameState {
  return { server: null, players: {}, events: [], lastUpdate: 0 };
}

export async function getGameState(): Promise<GameState> {
  try {
    const pool = getPool();
    const res = await pool.query(
      `SELECT value FROM live_state WHERE key = $1`,
      [STATE_KEY]
    );
    return res.rows.length > 0 ? (res.rows[0].value as GameState) : makeInitial();
  } catch {
    return makeInitial();
  }
}

export async function updateGameState(patch: Partial<GameState>): Promise<void> {
  const current = await getGameState();
  const next: GameState = { ...current, ...patch, lastUpdate: Date.now() };
  const pool = getPool();
  await pool.query(
    `INSERT INTO live_state (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [STATE_KEY, JSON.stringify(next)]
  );
}

export async function mergePlayers(
  incoming: Record<string, PlayerPosition>
): Promise<void> {
  const current = await getGameState();
  const next: GameState = {
    ...current,
    players: { ...current.players, ...incoming },
    lastUpdate: Date.now(),
  };
  const pool = getPool();
  await pool.query(
    `INSERT INTO live_state (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [STATE_KEY, JSON.stringify(next)]
  );
}
