"use client";

import {
  Bomb,
  Building2,
  Crosshair,
  Hammer,
  Leaf,
  Search,
  Shield,
  Skull,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { EmptyState, PageShell, Panel } from "@/components/DashboardUi";
import NavBar from "@/components/NavBar";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { usePolling } from "@/lib/usePolling";

interface PlayerRow {
  rank: number;
  steam_id: string;
  display_name: string;
  avatar_url: string;
  kills: number;
  deaths: number;
  headshots: number;
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

type Category = "overall" | "boss" | "npc" | "hunting" | "events" | "gathering" | "building" | "explosives";
type WipeScope = "current" | "lifetime";

const CATEGORIES: { id: Category; label: string; icon: LucideIcon }[] = [
  { id: "overall", label: "Overall", icon: Trophy },
  { id: "boss", label: "Boss Slayers", icon: Skull },
  { id: "npc", label: "Scientists", icon: Crosshair },
  { id: "hunting", label: "Hunting", icon: Leaf },
  { id: "events", label: "Heli / Bradley", icon: Shield },
  { id: "gathering", label: "Gathering", icon: Hammer },
  { id: "building", label: "Building", icon: Building2 },
  { id: "explosives", label: "Explosives", icon: Bomb },
];

export default function LeaderboardPage() {
  const [category, setCategory] = useState<Category>("overall");
  const [wipeScope, setWipeScope] = useState<WipeScope>("current");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 350);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLeaderboard = useCallback(async () => {
    setLoading((wasLoading) => wasLoading || players.length === 0);
    try {
      const params = new URLSearchParams({ category, wipe: wipeScope });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/leaderboard?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPlayers(data.players ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [category, wipeScope, debouncedSearch, players.length]);

  usePolling(fetchLeaderboard, 15000);

  const top3 = players.slice(0, 3);
  const activeCategory = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];

  return (
    <PageShell>
      <NavBar />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6">
        <section className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950/75 p-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-red-900/70 bg-red-950/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-red-300">
              <activeCategory.icon className="h-3.5 w-3.5" aria-hidden="true" />
              {activeCategory.label}
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white">Leaderboard</h1>
            <p className="mt-1 text-sm text-zinc-500">Current wipe and lifetime PvE performance across tracked server stats.</p>
          </div>

          <div className="inline-flex w-fit items-center gap-1 rounded-lg border border-zinc-800 bg-black/25 p-1">
            {(["current", "lifetime"] as WipeScope[]).map((scope) => (
              <button
                key={scope}
                onClick={() => setWipeScope(scope)}
                className={`h-8 rounded-md px-3 text-xs font-semibold transition-colors ${
                  wipeScope === scope ? "bg-red-600 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                }`}
              >
                {scope === "current" ? "Current Wipe" : "Lifetime"}
              </button>
            ))}
          </div>
        </section>

        {top3.length > 0 && (
          <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[top3[1], top3[0], top3[2]].map((p, index) => {
              if (!p) return <div key={index} />;
              const place = index === 0 ? 2 : index === 1 ? 1 : 3;
              return <PodiumPlayer key={p.steam_id} player={p} place={place} featured={place === 1} />;
            })}
          </section>
        )}

        <Panel
          title="Filters"
          action={
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" aria-hidden="true" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search player"
                className="h-9 w-48 rounded-md border border-zinc-800 bg-black/30 pl-8 pr-3 text-xs text-white outline-none placeholder:text-zinc-600 focus:border-zinc-600"
              />
            </div>
          }
        >
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition-colors ${
                  category === c.id
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-zinc-800 bg-black/20 text-zinc-400 hover:border-zinc-600 hover:text-white"
                }`}
              >
                <c.icon className="h-3.5 w-3.5" aria-hidden="true" />
                {c.label}
              </button>
            ))}
          </div>
        </Panel>

        <section className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/70">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  <th className="w-12 px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Player</th>
                  <th className="px-4 py-3 text-right">Time</th>
                  {renderHeaders(category)}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-zinc-500">
                      Loading leaderboard...
                    </td>
                  </tr>
                )}
                {!loading && players.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10">
                      <EmptyState>No data yet. Connect your Oxide plugin to start tracking.</EmptyState>
                    </td>
                  </tr>
                )}
                {!loading && players.map((p) => (
                  <tr key={p.steam_id} className="border-b border-zinc-900 last:border-0 hover:bg-zinc-900/60">
                    <td className="px-4 py-3 text-zinc-500">
                      <span className={rankColor(p.rank)}>#{p.rank}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-2">
                        {p.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.avatar_url} alt="" className="h-7 w-7 rounded-full border border-zinc-800" />
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-[10px] font-bold text-zinc-500">
                            {p.display_name[0]?.toUpperCase()}
                          </div>
                        )}
                        <Link href={`/player/${p.steam_id}`} className="max-w-[220px] truncate font-semibold text-zinc-200 hover:text-white">
                          {p.display_name}
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-zinc-500">{formatTime(p.playtime)}</td>
                    {renderCells(category, p)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </PageShell>
  );
}

function PodiumPlayer({ player, place, featured }: { player: PlayerRow; place: number; featured: boolean }) {
  return (
    <Link
      href={`/player/${player.steam_id}`}
      className={`flex items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-zinc-950 ${
        featured ? "border-yellow-500/60 bg-yellow-500/10" : "border-zinc-800 bg-zinc-950/70"
      }`}
    >
      <div className={`flex h-11 w-11 items-center justify-center rounded-md text-lg font-black ${
        featured ? "bg-yellow-400 text-black" : "bg-zinc-900 text-zinc-300"
      }`}>
        #{place}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-white">{player.display_name}</p>
        <p className="text-xs text-zinc-500">{player.rating} rating</p>
      </div>
    </Link>
  );
}

function renderHeaders(category: Category) {
  if (category === "overall") return (
    <>
      <th className="px-4 py-3 text-right">Boss</th>
      <th className="px-4 py-3 text-right">Animals</th>
      <th className="px-4 py-3 text-right">Heli</th>
      <th className="px-4 py-3 text-right">Bradley</th>
      <th className="px-4 py-3 text-right text-yellow-400">Rating</th>
    </>
  );
  if (category === "boss") return <th className="px-4 py-3 text-right">Boss Kills</th>;
  if (category === "npc") return (
    <>
      <th className="px-4 py-3 text-right">Scientists</th>
      <th className="px-4 py-3 text-right">Other NPCs</th>
      <th className="px-4 py-3 text-right">Total</th>
    </>
  );
  if (category === "hunting") return <th className="px-4 py-3 text-right">Animals</th>;
  if (category === "events") return (
    <>
      <th className="px-4 py-3 text-right">Heli</th>
      <th className="px-4 py-3 text-right">Bradley</th>
      <th className="px-4 py-3 text-right">Total</th>
    </>
  );
  if (category === "gathering") return (
    <>
      <th className="px-4 py-3 text-right">Wood</th>
      <th className="px-4 py-3 text-right">Stone</th>
      <th className="px-4 py-3 text-right">Metal</th>
      <th className="px-4 py-3 text-right">Sulfur</th>
      <th className="px-4 py-3 text-right">Total</th>
    </>
  );
  if (category === "building") return <th className="px-4 py-3 text-right">Structures</th>;
  return (
    <>
      <th className="px-4 py-3 text-right">Rockets</th>
      <th className="px-4 py-3 text-right">C4</th>
      <th className="px-4 py-3 text-right">Satchels</th>
      <th className="px-4 py-3 text-right">Total</th>
    </>
  );
}

function renderCells(category: Category, p: PlayerRow) {
  if (category === "overall") return (
    <>
      <td className="px-4 py-3 text-right font-semibold text-red-400">{p.boss_kills}</td>
      <td className="px-4 py-3 text-right text-emerald-300">{p.animal_kills}</td>
      <td className="px-4 py-3 text-right text-red-300">{p.heli_kills}</td>
      <td className="px-4 py-3 text-right text-orange-300">{p.bradley_kills}</td>
      <td className="px-4 py-3 text-right font-bold text-yellow-300">{p.rating}</td>
    </>
  );
  if (category === "boss") return <td className="px-4 py-3 text-right font-bold text-red-400">{p.boss_kills}</td>;
  if (category === "npc") return (
    <>
      <td className="px-4 py-3 text-right text-cyan-300">{p.scientist_kills}</td>
      <td className="px-4 py-3 text-right">{p.npc_kills}</td>
      <td className="px-4 py-3 text-right font-semibold">{p.scientist_kills + p.npc_kills}</td>
    </>
  );
  if (category === "hunting") return <td className="px-4 py-3 text-right font-semibold text-emerald-300">{p.animal_kills}</td>;
  if (category === "events") return (
    <>
      <td className="px-4 py-3 text-right text-red-300">{p.heli_kills}</td>
      <td className="px-4 py-3 text-right text-orange-300">{p.bradley_kills}</td>
      <td className="px-4 py-3 text-right font-semibold">{p.heli_kills + p.bradley_kills}</td>
    </>
  );
  if (category === "gathering") {
    const total = p.wood + p.stone + p.metal_ore + p.sulfur_ore;
    return (
      <>
        <td className="px-4 py-3 text-right text-amber-600">{p.wood.toLocaleString()}</td>
        <td className="px-4 py-3 text-right text-zinc-300">{p.stone.toLocaleString()}</td>
        <td className="px-4 py-3 text-right text-sky-300">{p.metal_ore.toLocaleString()}</td>
        <td className="px-4 py-3 text-right text-yellow-300">{p.sulfur_ore.toLocaleString()}</td>
        <td className="px-4 py-3 text-right font-semibold">{total.toLocaleString()}</td>
      </>
    );
  }
  if (category === "building") return <td className="px-4 py-3 text-right font-semibold">{p.structures_placed.toLocaleString()}</td>;
  return (
    <>
      <td className="px-4 py-3 text-right">{p.rockets_fired}</td>
      <td className="px-4 py-3 text-right text-red-300">{p.c4_thrown}</td>
      <td className="px-4 py-3 text-right text-orange-300">{p.satchels}</td>
      <td className="px-4 py-3 text-right font-semibold">{p.rockets_fired + p.c4_thrown + p.satchels}</td>
    </>
  );
}

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function rankColor(rank: number) {
  if (rank === 1) return "font-bold text-yellow-300";
  if (rank === 2) return "font-bold text-zinc-300";
  if (rank === 3) return "font-bold text-orange-300";
  return "";
}
