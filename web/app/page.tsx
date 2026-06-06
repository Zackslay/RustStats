"use client";

import {
  Activity,
  Anchor,
  Copy,
  Map,
  Play,
  Shield,
  Skull,
  Trophy,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import NavBar from "@/components/NavBar";
import KillFeed from "@/components/KillFeed";
import PopulationChart from "@/components/PopulationChart";
import { EmptyState, PageShell, Panel, StatCard, StatusPill } from "@/components/DashboardUi";
import type { GameState } from "@/lib/gameState";
import { compact, formatPlaytime, gridFromXZ, relativeTime } from "@/lib/format";
import { usePolling } from "@/lib/usePolling";

interface TopRow {
  rank: number;
  steam_id: string;
  display_name: string;
  avatar_url: string;
  kills: number;
  rating: number;
}

interface Totals {
  players: number;
  npcKills: number;
  animalKills: number;
  bossKills: number;
  gathered: number;
  structures: number;
  playtime: number;
}

export default function Home() {
  const [state, setState] = useState<(GameState & { wipe?: Record<string, unknown> | null }) | null>(null);
  const [top, setTop] = useState<TopRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [copied, setCopied] = useState(false);
  const [nowSec, setNowSec] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [gs, lb, st] = await Promise.all([
        fetch("/api/gamestate").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/leaderboard?category=overall&wipe=current&limit=5").then((r) =>
          r.ok ? r.json() : null
        ),
        fetch("/api/stats").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (gs) setState(gs);
      if (lb) setTop(lb.players ?? []);
      if (st) setTotals(st);
    } catch {
      // Keep the last good dashboard payload visible through transient API errors.
    }
  }, []);

  const tickClock = useCallback(() => {
    setNowSec(Math.floor(Date.now() / 1000));
  }, []);

  usePolling(refresh, 5000);
  usePolling(tickClock, 1000);

  const server = state?.server ?? null;
  const online = state ? Object.values(state.players).filter((p) => p.online).length : 0;
  const isLive = !!server && nowSec > 0 && nowSec - (server.updatedAt ?? 0) < 30;
  const brand = process.env.NEXT_PUBLIC_BRAND || "RustStats";
  const reportedIp = server?.ip && server.ip !== "" && server.ip !== "0.0.0.0"
    ? `${server.ip}:${server.port}` : "";
  const connect = process.env.NEXT_PUBLIC_SERVER_CONNECT || reportedIp;

  const topEvent = useMemo(() => state?.events.find((ev) => ev.type === "boss") ?? state?.events[0], [state?.events]);

  const copyConnect = () => {
    if (!connect) return;
    navigator.clipboard?.writeText(connect).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <PageShell className="flex flex-col">
      <NavBar />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
        <section className="rounded-lg border border-zinc-800 bg-zinc-950/75 p-5 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <StatusPill live={isLive} label={isLive ? "Live" : "Offline"} />
                <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">{brand}</span>
                {state?.lastUpdate ? (
                  <span className="text-xs text-zinc-600">Updated {new Date(state.lastUpdate).toLocaleTimeString()}</span>
                ) : null}
              </div>
              <h1 className="truncate text-3xl font-black tracking-tight text-white sm:text-4xl">
                {server?.name ?? "Waiting for server data"}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-zinc-400">
                Live population, event tracking, PvE leaderboards, and player stats from the connected Rust plugin.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {connect ? (
                <>
                  <a
                    href={`steam://connect/${connect}`}
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-bold text-white transition-colors hover:bg-red-500"
                  >
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                    Join Server
                  </a>
                  <button
                    onClick={copyConnect}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                    title="Copy connect IP"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    {copied ? "Copied" : "Copy IP"}
                  </button>
                </>
              ) : (
                <span className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
                  Connect address unavailable
                </span>
              )}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard icon={Users} label="Players" value={`${online}${server?.maxPlayers ? ` / ${server.maxPlayers}` : ""}`} />
            <StatCard icon={Map} label="Map Size" value={server?.mapSize ? `${server.mapSize}` : "-"} />
            <StatCard icon={Shield} label="Seed" value={server?.mapSeed ? `${server.mapSeed}` : "-"} />
            <StatCard label="Wiped" value={server?.wipeDate ? `${relativeTime(server.wipeDate)}` : "-"} />
          </div>
        </section>

        {topEvent && (
          <section className="rounded-lg border border-red-900/60 bg-red-950/25 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <EventIcon type={topEvent.type} />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-red-300">Priority Event</p>
                <p className="truncate text-sm font-bold text-white">{topEvent.label}</p>
              </div>
              <span className="rounded-md border border-red-800/70 bg-black/25 px-2.5 py-1 text-xs font-semibold text-red-100">
                {gridFromXZ(topEvent.x, topEvent.z, server?.mapSize ?? 3500)}
              </span>
              {topEvent.health !== undefined && (
                <span className="text-xs font-semibold text-red-200">{topEvent.health} HP</span>
              )}
            </div>
          </section>
        )}

        {state && state.events.length > 1 && (
          <Panel title="Live Events">
            <div className="flex flex-wrap gap-2">
              {state.events.map((ev, i) => (
                <div
                  key={`${ev.type}-${i}`}
                  className="flex items-center gap-2 rounded-md border border-zinc-800 bg-black/25 px-3 py-2 text-xs text-zinc-300"
                >
                  <EventIcon type={ev.type} compact />
                  <span className="font-semibold">{ev.label}</span>
                  <span className="text-zinc-500">{gridFromXZ(ev.x, ev.z, server?.mapSize ?? 3500)}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NavCard href="/map" icon={Map} title="Live Map" desc="Players, events, monuments, boss markers, and recent death locations." />
          <NavCard href="/leaderboard" icon={Trophy} title="Leaderboard" desc="Current wipe and lifetime PvE rankings across boss, event, and gathering stats." />
        </section>

        {totals && (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Players" value={totals.players.toLocaleString()} />
            <StatCard label="NPC Kills" value={totals.npcKills.toLocaleString()} />
            <StatCard label="Animals" value={totals.animalKills.toLocaleString()} />
            <StatCard label="Boss Kills" value={totals.bossKills.toLocaleString()} accent="text-red-400" />
            <StatCard label="Gathered" value={compact(totals.gathered)} />
            <StatCard label="Playtime" value={formatPlaytime(totals.playtime)} />
          </section>
        )}

        <Panel title="Population - Last 24h">
          <PopulationChart sinceSeconds={86400} />
        </Panel>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Top Players" action={<Link href="/leaderboard" className="text-xs font-semibold text-zinc-500 hover:text-white">View all</Link>}>
            {top.length === 0 ? (
              <EmptyState>No stats yet.</EmptyState>
            ) : (
              <ul className="flex flex-col divide-y divide-zinc-900">
                {top.map((p) => (
                  <li key={p.steam_id} className="flex items-center gap-3 py-2">
                    <span className="w-7 text-center text-xs font-bold text-zinc-500">#{p.rank}</span>
                    {p.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatar_url} alt="" className="h-8 w-8 rounded-full border border-zinc-800" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-[11px] font-bold text-zinc-500">
                        {p.display_name?.[0]?.toUpperCase()}
                      </div>
                    )}
                    <Link href={`/player/${p.steam_id}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-200 hover:text-white">
                      {p.display_name}
                    </Link>
                    <span className="w-20 text-right text-xs font-bold text-yellow-300">{p.rating} pts</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Recent Kills">
            <KillFeed limit={15} scope="current" />
          </Panel>
        </section>
      </main>
    </PageShell>
  );
}

function EventIcon({ type, compact = false }: { type: string; compact?: boolean }) {
  const Icon = type === "boss" ? Skull : type === "cargo" ? Anchor : type === "bradley" ? Shield : Activity;
  return (
    <span className={`inline-flex items-center justify-center rounded-md border ${
      type === "boss" ? "border-red-700 bg-red-950 text-red-300" : "border-zinc-800 bg-zinc-950 text-zinc-400"
    } ${compact ? "h-6 w-6" : "h-9 w-9"}`}>
      <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
    </span>
  );
}

function NavCard({ href, icon: Icon, title, desc }: { href: string; icon: typeof Map; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 transition-colors hover:border-red-700 hover:bg-zinc-950"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-md border border-zinc-800 bg-black/30 text-red-400 group-hover:border-red-800">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold uppercase tracking-wide text-white">{title}</span>
        <span className="block text-xs leading-5 text-zinc-500">{desc}</span>
      </span>
    </Link>
  );
}
