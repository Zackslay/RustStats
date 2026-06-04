"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import NavBar from "@/components/NavBar";
import KillFeed from "@/components/KillFeed";
import PopulationChart from "@/components/PopulationChart";
import type { GameState } from "@/lib/gameState";
import { compact, formatPlaytime, relativeTime } from "@/lib/format";

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
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const server = state?.server ?? null;
  const online = state ? Object.values(state.players).filter((p) => p.online).length : 0;
  const isLive = !!server && Date.now() / 1000 - (server.updatedAt ?? 0) < 30;

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white flex flex-col">
      <NavBar />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8 space-y-8">
        {/* Hero / server status */}
        <section className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-black tracking-tight">
                RUST<span className="text-red-500">STATS</span>
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                {server?.name ?? "Waiting for server data…"}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${isLive ? "bg-emerald-500 animate-pulse" : "bg-gray-600"}`}
              />
              <span className={isLive ? "text-emerald-400" : "text-gray-500"}>
                {isLive ? "Online" : "Offline"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            <Stat label="Players" value={`${online}${server?.maxPlayers ? ` / ${server.maxPlayers}` : ""}`} />
            <Stat label="Map Size" value={server?.mapSize ? `${server.mapSize}` : "—"} />
            <Stat label="Seed" value={server?.mapSeed ? `${server.mapSeed}` : "—"} />
            <Stat
              label="Wiped"
              value={server?.wipeDate ? `${relativeTime(server.wipeDate)}` : "—"}
            />
          </div>
        </section>

        {/* Nav cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NavCard href="/map" icon="🗺️" title="LIVE MAP" desc="Players, heli, bradley, cargo & monuments" />
          <NavCard href="/leaderboard" icon="🏆" title="LEADERBOARD" desc="Kills, gathering, explosives & more" />
        </section>

        {/* This-wipe totals */}
        {totals && (
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat label="Players" value={totals.players.toLocaleString()} />
            <Stat label="NPC Kills" value={totals.npcKills.toLocaleString()} />
            <Stat label="Animals" value={totals.animalKills.toLocaleString()} />
            <Stat label="Heli/Bradley" value={totals.bossKills.toLocaleString()} />
            <Stat label="Gathered" value={compact(totals.gathered)} />
            <Stat label="Playtime" value={formatPlaytime(totals.playtime)} />
          </section>
        )}

        {/* Population history */}
        <Panel title="Population (last 24h)">
          <PopulationChart sinceSeconds={86400} />
        </Panel>

        {/* Top players + kill feed */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title="Top Players" action={<Link href="/leaderboard" className="text-xs text-gray-500 hover:text-white">View all →</Link>}>
            {top.length === 0 ? (
              <p className="text-gray-600 text-xs px-1 py-2">No stats yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-[#1e1e1e]">
                {top.map((p) => (
                  <li key={p.steam_id} className="flex items-center gap-3 py-2">
                    <span className="text-gray-500 text-xs w-5 text-center">#{p.rank}</span>
                    {p.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-[#2a2a2a] flex items-center justify-center text-[10px] text-gray-500">
                        {p.display_name?.[0]?.toUpperCase()}
                      </div>
                    )}
                    <Link href={`/player/${p.steam_id}`} className="text-sm font-medium truncate flex-1 hover:underline">
                      {p.display_name}
                    </Link>
                    <span className="text-xs font-bold text-yellow-400 w-16 text-right">{p.rating} pts</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Recent Kills">
            <KillFeed limit={15} scope="current" />
          </Panel>
        </section>

        <p className="text-[11px] text-gray-600 text-center">
          Last update: {state?.lastUpdate ? new Date(state.lastUpdate).toLocaleTimeString() : "—"}
        </p>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0f0f0f] border border-[#222] rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
    </div>
  );
}

function NavCard({ href, icon, title, desc }: { href: string; icon: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 bg-[#161616] border border-[#2a2a2a] rounded-xl p-5 hover:border-red-600 hover:bg-[#1a1a1a] transition-all group"
    >
      <span className="text-3xl">{icon}</span>
      <div>
        <div className="font-bold text-sm tracking-wide group-hover:text-red-400 transition-colors">{title}</div>
        <div className="text-xs text-gray-500">{desc}</div>
      </div>
    </Link>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[10px] uppercase tracking-widest text-gray-500">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
