"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

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
  heli_hits: number;
  bradley_hits: number;
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

const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: "overall", label: "Overall", icon: "🏆" },
  { id: "boss", label: "Boss Slayers", icon: "💀" },
  { id: "npc", label: "Scientists & NPCs", icon: "☣️" },
  { id: "hunting", label: "Hunting", icon: "🏹" },
  { id: "events", label: "Heli / Bradley", icon: "🚁" },
  { id: "gathering", label: "Gathering", icon: "⛏️" },
  { id: "building", label: "Building", icon: "🏗️" },
  { id: "explosives", label: "Explosives", icon: "💣" },
];

export default function LeaderboardPage() {
  const [category, setCategory] = useState<Category>("overall");
  const [wipeScope, setWipeScope] = useState<WipeScope>("current");
  const [search, setSearch] = useState("");
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ category, wipe: wipeScope });
      if (search) params.set("search", search);
      const res = await fetch(`/api/leaderboard?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPlayers(data.players ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [category, wipeScope, search]);

  useEffect(() => {
    fetchLeaderboard();
    const id = setInterval(fetchLeaderboard, 15000);
    return () => clearInterval(id);
  }, [fetchLeaderboard]);

  function totalGathered(row: PlayerRow) {
    return (row.wood + row.stone + row.metal_ore + row.sulfur_ore).toLocaleString();
  }

  function formatTime(seconds: number) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  const top3 = players.slice(0, 3);
  const rest = players.slice(3);

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white">
      {/* Header */}
      <header className="px-6 py-4 bg-[#161616] border-b border-[#2a2a2a] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-red-500 font-bold text-xl tracking-tight">
            RUST<span className="text-white">STATS</span>
          </span>
          <span className="text-gray-600">|</span>
          <a href="/map" className="text-xs text-gray-400 hover:text-white transition-colors">
            Live Map →
          </a>
        </div>

        {/* Wipe scope toggle */}
        <div className="flex items-center gap-1 bg-[#0f0f0f] rounded p-0.5 border border-[#2a2a2a]">
          {(["current", "lifetime"] as WipeScope[]).map((w) => (
            <button
              key={w}
              onClick={() => setWipeScope(w)}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${
                wipeScope === w
                  ? "bg-red-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {w === "current" ? "Current Wipe" : "Lifetime"}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Top 3 podium */}
        {top3.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {[top3[1], top3[0], top3[2]].map((p, i) => {
              if (!p) return <div key={i} />;
              const place = i === 0 ? 2 : i === 1 ? 1 : 3;
              const heights = ["h-24", "h-32", "h-20"];
              const colors = [
                "border-gray-400 text-gray-300",
                "border-yellow-400 text-yellow-300",
                "border-orange-500 text-orange-400",
              ];
              return (
                <div
                  key={p.steam_id}
                  className={`flex flex-col items-center justify-end bg-[#161616] border rounded-lg p-4 ${colors[i]} ${heights[i]}`}
                >
                  <div className="text-2xl font-bold">#{place}</div>
                  <div className="text-sm font-semibold truncate max-w-full">
                    {p.display_name}
                  </div>
                  <div className="text-xs opacity-70">{p.rating} pts</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Category tabs */}
        <div className="flex gap-1 flex-wrap">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors ${
                category === c.id
                  ? "bg-red-600 border-red-500 text-white"
                  : "border-[#2a2a2a] text-gray-400 hover:text-white hover:border-[#444]"
              }`}
            >
              <span>{c.icon}</span>
              {c.label}
            </button>
          ))}

          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player..."
            className="ml-auto text-xs px-3 py-1.5 bg-[#161616] border border-[#2a2a2a] rounded text-white placeholder:text-gray-600 focus:outline-none focus:border-[#444] w-48"
          />
        </div>

        {/* Table */}
        <div className="bg-[#161616] border border-[#2a2a2a] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2a2a] text-[10px] uppercase tracking-widest text-gray-500">
                <th className="px-4 py-3 text-left w-10">#</th>
                <th className="px-4 py-3 text-left">Player</th>
                <th className="px-4 py-3 text-right">Time</th>
                {category === "overall" && (
                  <>
                    <th className="px-4 py-3 text-right">Boss</th>
                    <th className="px-4 py-3 text-right">Animals</th>
                    <th className="px-4 py-3 text-right">Heli</th>
                    <th className="px-4 py-3 text-right">Bradley</th>
                    <th className="px-4 py-3 text-right text-yellow-500">Rating</th>
                  </>
                )}
                {category === "boss" && (
                  <th className="px-4 py-3 text-right">Boss Kills</th>
                )}
                {category === "npc" && (
                  <>
                    <th className="px-4 py-3 text-right">Scientists</th>
                    <th className="px-4 py-3 text-right">Other NPCs</th>
                    <th className="px-4 py-3 text-right">Total</th>
                  </>
                )}
                {category === "hunting" && (
                  <th className="px-4 py-3 text-right">Animals Killed</th>
                )}
                {category === "events" && (
                  <>
                    <th className="px-4 py-3 text-right">Heli Kills</th>
                    <th className="px-4 py-3 text-right">Bradley Kills</th>
                    <th className="px-4 py-3 text-right">Total</th>
                  </>
                )}
                {category === "gathering" && (
                  <>
                    <th className="px-4 py-3 text-right">Wood</th>
                    <th className="px-4 py-3 text-right">Stone</th>
                    <th className="px-4 py-3 text-right">Metal</th>
                    <th className="px-4 py-3 text-right">Sulfur</th>
                    <th className="px-4 py-3 text-right">Total</th>
                  </>
                )}
                {category === "building" && (
                  <th className="px-4 py-3 text-right">Structures</th>
                )}
                {category === "explosives" && (
                  <>
                    <th className="px-4 py-3 text-right">Rockets</th>
                    <th className="px-4 py-3 text-right">C4</th>
                    <th className="px-4 py-3 text-right">Satchels</th>
                    <th className="px-4 py-3 text-right">Total</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              )}
              {!loading && players.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                    No data yet — connect your Oxide plugin to start tracking.
                  </td>
                </tr>
              )}
              {[...top3, ...rest].map((p, idx) => (
                <tr
                  key={p.steam_id}
                  className={`border-b border-[#1e1e1e] last:border-0 hover:bg-[#1a1a1a] transition-colors ${
                    idx < 3 ? "bg-[#191919]" : ""
                  }`}
                >
                  <td className="px-4 py-3 text-gray-500">
                    {p.rank <= 3 ? (
                      <span className={rankColor(p.rank)}>#{p.rank}</span>
                    ) : (
                      `#${p.rank}`
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {p.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.avatar_url}
                          alt=""
                          className="w-6 h-6 rounded-full"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-[#2a2a2a] flex items-center justify-center text-[10px] text-gray-500">
                          {p.display_name[0]?.toUpperCase()}
                        </div>
                      )}
                      <Link href={`/player/${p.steam_id}`} className="font-medium hover:underline hover:text-red-400 transition-colors">
                        {p.display_name}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400 text-xs">
                    {formatTime(p.playtime)}
                  </td>

                  {category === "overall" && (
                    <>
                      <td className="px-4 py-3 text-right text-red-500 font-medium">{p.boss_kills}</td>
                      <td className="px-4 py-3 text-right text-green-400">{p.animal_kills}</td>
                      <td className="px-4 py-3 text-right text-red-400">{p.heli_kills}</td>
                      <td className="px-4 py-3 text-right text-orange-400">{p.bradley_kills}</td>
                      <td className="px-4 py-3 text-right font-bold text-yellow-400">{p.rating}</td>
                    </>
                  )}
                  {category === "boss" && (
                    <td className="px-4 py-3 text-right font-bold text-red-500">{p.boss_kills}</td>
                  )}
                  {category === "npc" && (
                    <>
                      <td className="px-4 py-3 text-right text-cyan-400">{p.scientist_kills}</td>
                      <td className="px-4 py-3 text-right">{p.npc_kills}</td>
                      <td className="px-4 py-3 text-right font-medium">{p.scientist_kills + p.npc_kills}</td>
                    </>
                  )}
                  {category === "hunting" && (
                    <td className="px-4 py-3 text-right font-medium text-green-400">{p.animal_kills}</td>
                  )}
                  {category === "events" && (
                    <>
                      <td className="px-4 py-3 text-right text-red-400">{p.heli_kills}</td>
                      <td className="px-4 py-3 text-right text-orange-400">{p.bradley_kills}</td>
                      <td className="px-4 py-3 text-right font-medium">{p.heli_kills + p.bradley_kills}</td>
                    </>
                  )}
                  {category === "gathering" && (
                    <>
                      <td className="px-4 py-3 text-right text-amber-700">{p.wood.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-gray-300">{p.stone.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-blue-400">{p.metal_ore.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-yellow-500">{p.sulfur_ore.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-medium">{totalGathered(p)}</td>
                    </>
                  )}
                  {category === "building" && (
                    <td className="px-4 py-3 text-right font-medium">{p.structures_placed.toLocaleString()}</td>
                  )}
                  {category === "explosives" && (
                    <>
                      <td className="px-4 py-3 text-right">{p.rockets_fired}</td>
                      <td className="px-4 py-3 text-right text-red-400">{p.c4_thrown}</td>
                      <td className="px-4 py-3 text-right text-orange-400">{p.satchels}</td>
                      <td className="px-4 py-3 text-right font-medium">{p.rockets_fired + p.c4_thrown + p.satchels}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function rankColor(rank: number) {
  if (rank === 1) return "text-yellow-400 font-bold";
  if (rank === 2) return "text-gray-300 font-bold";
  if (rank === 3) return "text-orange-500 font-bold";
  return "";
}
