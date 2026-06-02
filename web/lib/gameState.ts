import { sql } from "@vercel/postgres";

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
  type: "heli" | "bradley" | "cargo" | "chinook";
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
}

export interface GameState {
  server: ServerInfo | null;
  players: Record<string, PlayerPosition>;
  events: ActiveEvent[];
  lastUpdate: number;
}

const STATE_KEY = "game_state";

function makeInitial(): GameState {
  return { server: null, players: {}, events: [], lastUpdate: 0 };
}

export async function getGameState(): Promise<GameState> {
  try {
    const { rows } = await sql`
      SELECT value FROM live_state WHERE key = ${STATE_KEY}
    `;
    return rows.length > 0 ? (rows[0].value as GameState) : makeInitial();
  } catch {
    return makeInitial();
  }
}

export async function updateGameState(patch: Partial<GameState>): Promise<void> {
  const current = await getGameState();
  const next: GameState = { ...current, ...patch, lastUpdate: Date.now() };
  const json = JSON.stringify(next);
  await sql`
    INSERT INTO live_state (key, value, updated_at)
    VALUES (${STATE_KEY}, ${json}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value      = EXCLUDED.value,
      updated_at = NOW()
  `;
}

// Merge only the players map (avoids a read-modify-write race for position updates)
export async function mergePlayers(
  incoming: Record<string, PlayerPosition>
): Promise<void> {
  // We do a full read here — plugin pushes are the only writer so races are rare
  const current = await getGameState();
  const next: GameState = {
    ...current,
    players: { ...current.players, ...incoming },
    lastUpdate: Date.now(),
  };
  const json = JSON.stringify(next);
  await sql`
    INSERT INTO live_state (key, value, updated_at)
    VALUES (${STATE_KEY}, ${json}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value      = EXCLUDED.value,
      updated_at = NOW()
  `;
}
