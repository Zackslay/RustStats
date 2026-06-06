"use client";

import {
  Activity,
  BarChart3,
  Bomb,
  Building2,
  CalendarDays,
  Clock,
  Hammer,
  Leaf,
  Map,
  Shield,
  Skull,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { EmptyState, PageShell, Panel, StatCard, StatusPill } from "@/components/DashboardUi";
import NavBar from "@/components/NavBar";
import type { GameState } from "@/lib/gameState";
import { compact, formatPlaytime, gridFromXZ } from "@/lib/format";
import { usePolling } from "@/lib/usePolling";

interface Totals {
  players: number;
  npcKills: number;
  animalKills: number;
  bossKills: number;
  gathered: number;
  structures: number;
  playtime: number;
}

interface PlayerRow {
  rank: number;
  steam_id: string;
  display_name: string;
  avatar_url: string;
  kills: number;
  deaths: number;
  wood: number;
  stone: number;
  metal_ore: number;
  sulfur_ore: number;
  structures_placed: number;
  rockets_fired: number;
  c4_thrown: number;
  satchels: number;
  npc_kills: number;
  scientist_kills: number;
  animal_kills: number;
  heli_kills: number;
  bradley_kills: number;
  boss_kills: number;
  playtime: number;
  rating: number;
}

type Board = "overall" | "boss" | "events" | "gathering" | "building" | "explosives" | "npc";

const BOARDS: { id: Board; title: string; icon: LucideIcon; metric: (p: PlayerRow) => string }[] = [
  { id: "overall", title: "Wipe MVP", icon: Trophy, metric: (p) => `${p.rating} rating` },
  { id: "boss", title: "Boss Slayer", icon: Skull, metric: (p) => `${p.boss_kills} boss kills` },
  { id: "events", title: "Event Hunter", icon: Shield, metric: (p) => `${p.heli_kills + p.bradley_kills} clears` },
  { id: "gathering", title: "Resource Lead", icon: Hammer, metric: (p) => compact(p.wood + p.stone + p.metal_ore + p.sulfur_ore) },
  { id: "building", title: "Builder", icon: Building2, metric: (p) => `${p.structures_placed.toLocaleString()} placed` },
  { id: "explosives", title: "Demolition", icon: Bomb, metric: (p) => `${p.rockets_fired + p.c4_thrown + p.satchels} used` },
  { id: "npc", title: "NPC Hunter", icon: Activity, metric: (p) => `${p.scientist_kills + p.npc_kills} kills` },
];

export default function WipePage() {
  const [state, setState] = useState<(GameState & { wipe?: Record<string, unknown> | null }) | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [boards, setBoards] = useState<Record<Board, PlayerRow[]>>({
    overall: [],
    boss: [],
    events: [],
    gathering: [],
    building: [],
    explosives: [],
    npc: [],
  });
  const [nowSec, setNowSec] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [gs, st, ...leaderboards] = await Promise.all([
        fetch("/api/gamestate").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/stats").then((r) => (r.ok ? r.json() : null)),
        ...BOARDS.map((board) =>
          fetch(`/api/leaderboard?category=${board.id}&wipe=current&limit=5`).then((r) => (r.ok ? r.json() : null))
        ),
      ]);
      if (gs) setState(gs);
      if (st) setTotals(st);
      setBoards((current) => {
        const next = { ...current };
        BOARDS.forEach((board, index) => {
          next[board.id] = leaderboards[index]?.players ?? [];
        });
        return next;
      });
    } catch {
      // Keep last good wipe room data visible through transient API errors.
    }
  }, []);

  const tickClock = useCallback(() => {
    setNowSec(Math.floor(Date.now() / 1000));
  }, []);

  usePolling(refresh, 10000);
  usePolling(tickClock, 1000);

  const server = state?.server ?? null;
  const online = state ? Object.values(state.players).filter((p) => p.online).length : 0;
  const isLive = !!server && nowSec > 0 && nowSec - (server.updatedAt ?? 0) < 30;
  const activeBoss = state?.events.find((event) => event.type === "boss");
  const wipeDate = server?.wipeDate ?? null;
  const wipeStarted = wipeDate ? new Date(wipeDate * 1000) : null;
  const daysLive = wipeDate ? Math.max(0, Math.floor((nowSec - wipeDate) / 86400)) : 0;
  const topFive = boards.overall.slice(0, 5);

  const story = useMemo(() => {
    if (!totals) return "Waiting for current wipe statistics.";
    const pieces = [
      `${totals.players.toLocaleString()} tracked players`,
      `${compact(totals.gathered)} resources gathered`,
      `${totals.npcKills.toLocaleString()} NPC kills`,
      `${totals.bossKills.toLocaleString()} boss clears`,
    ];
    return pieces.join(" / ");
  }, [totals]);

  return (
    <PageShell className="flex flex-col">
      <NavBar />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
        <section className="rounded-lg border border-zinc-800 bg-zinc-950/75 p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <StatusPill live={isLive} label={isLive ? "Wipe Live" : "Awaiting Server"} />
                <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  {server?.name ?? "Rust server"}
                </span>
              </div>
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Wipe Room</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{story}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs sm:w-80">
              <MiniIntel icon={CalendarDays} label="Started" value={wipeStarted ? wipeStarted.toLocaleDateString() : "-"} />
              <MiniIntel icon={Clock} label="Age" value={wipeDate ? `${daysLive}d` : "-"} />
              <MiniIntel icon={Users} label="Online" value={`${online}${server?.maxPlayers ? `/${server.maxPlayers}` : ""}`} />
              <MiniIntel icon={Map} label="Map" value={server?.mapSize ? `${server.mapSize}` : "-"} />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={Users} label="Tracked Players" value={totals?.players.toLocaleString() ?? "-"} />
          <StatCard icon={Activity} label="NPC Kills" value={totals?.npcKills.toLocaleString() ?? "-"} />
          <StatCard icon={Leaf} label="Animals" value={totals?.animalKills.toLocaleString() ?? "-"} accent="text-emerald-300" />
          <StatCard icon={Shield} label="Boss Clears" value={totals?.bossKills.toLocaleString() ?? "-"} accent="text-red-300" />
          <StatCard icon={Hammer} label="Gathered" value={totals ? compact(totals.gathered) : "-"} />
          <StatCard icon={Building2} label="Structures" value={totals?.structures.toLocaleString() ?? "-"} />
          <StatCard icon={Clock} label="Playtime" value={totals ? formatPlaytime(totals.playtime) : "-"} />
          <StatCard icon={BarChart3} label="Wipe Age" value={wipeDate ? `${daysLive} days` : "-"} />
        </section>

        {activeBoss && (
          <section className="rounded-lg border border-red-800/70 bg-red-950/25 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-md border border-red-700 bg-red-950 text-red-300">
                <Skull className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-red-300">Boss currently active</p>
                <p className="truncate text-lg font-black text-white">{activeBoss.label}</p>
              </div>
              <Link
                href="/map"
                className="rounded-md border border-red-700/70 bg-black/25 px-3 py-2 text-xs font-bold text-red-100 hover:bg-red-950"
              >
                View at {gridFromXZ(activeBoss.x, activeBoss.z, server?.mapSize ?? 3500)}
              </Link>
            </div>
          </section>
        )}

        <Panel title="Wipe Champions">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {BOARDS.map((board) => (
              <ChampionCard key={board.id} title={board.title} icon={board.icon} player={boards[board.id][0]} metric={board.metric} />
            ))}
          </div>
        </Panel>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Top Five Overall" action={<Link href="/leaderboard" className="text-xs font-semibold text-zinc-500 hover:text-white">Full leaderboard</Link>}>
            {topFive.length === 0 ? (
              <EmptyState>No wipe rankings yet.</EmptyState>
            ) : (
              <ul className="flex flex-col divide-y divide-zinc-900">
                {topFive.map((player) => (
                  <li key={player.steam_id} className="flex items-center gap-3 py-2">
                    <span className="w-7 text-center text-xs font-bold text-zinc-500">#{player.rank}</span>
                    <PlayerAvatar player={player} />
                    <Link href={`/player/${player.steam_id}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-200 hover:text-white">
                      {player.display_name}
                    </Link>
                    <span className="text-xs font-bold text-yellow-300">{player.rating}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Event Breakdown">
            <div className="grid grid-cols-2 gap-3">
              <Breakdown label="Boss kills" value={boards.boss[0]?.boss_kills ?? 0} caption={boards.boss[0]?.display_name ?? "Unclaimed"} />
              <Breakdown label="Heli clears" value={boards.events[0]?.heli_kills ?? 0} caption={boards.events[0]?.display_name ?? "Unclaimed"} />
              <Breakdown label="Bradley clears" value={boards.events[0]?.bradley_kills ?? 0} caption={boards.events[0]?.display_name ?? "Unclaimed"} />
              <Breakdown label="Explosives" value={boards.explosives[0] ? boards.explosives[0].rockets_fired + boards.explosives[0].c4_thrown + boards.explosives[0].satchels : 0} caption={boards.explosives[0]?.display_name ?? "Unclaimed"} />
            </div>
          </Panel>
        </section>
      </main>
    </PageShell>
  );
}

function MiniIntel({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-black/25 p-3">
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </div>
      <p className="truncate text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function ChampionCard({ title, icon: Icon, player, metric }: { title: string; icon: LucideIcon; player?: PlayerRow; metric: (player: PlayerRow) => string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-black/20 p-4">
      <div className="mb-4 flex items-center justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-red-400">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{title}</span>
      </div>
      {player ? (
        <div className="flex items-center gap-3">
          <PlayerAvatar player={player} />
          <div className="min-w-0">
            <Link href={`/player/${player.steam_id}`} className="block truncate text-sm font-black text-white hover:text-red-300">
              {player.display_name}
            </Link>
            <p className="text-xs text-zinc-500">{metric(player)}</p>
          </div>
        </div>
      ) : (
        <p className="text-sm font-bold text-zinc-500">Unclaimed</p>
      )}
    </div>
  );
}

function PlayerAvatar({ player }: { player: PlayerRow }) {
  if (player.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={player.avatar_url} alt="" className="h-8 w-8 rounded-full border border-zinc-800" />
    );
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-[11px] font-bold text-zinc-500">
      {player.display_name?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

function Breakdown({ label, value, caption }: { label: string; value: number; caption: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-black text-white">{value.toLocaleString()}</p>
      <p className="mt-1 truncate text-xs text-zinc-600">{caption}</p>
    </div>
  );
}
