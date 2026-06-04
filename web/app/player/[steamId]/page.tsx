"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import NavBar from "@/components/NavBar";
import KillFeed from "@/components/KillFeed";
import { formatPlaytime, relativeTime } from "@/lib/format";

type Totals = Record<string, number>;
interface Profile {
  player: {
    steam_id: string;
    display_name: string;
    avatar_url: string;
    first_seen: number;
    last_seen: number;
  } | null;
  current: Totals;
  lifetime: Totals;
}

type Scope = "current" | "lifetime";

export default function PlayerPage() {
  const params = useParams<{ steamId: string }>();
  const steamId = params.steamId;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [scope, setScope] = useState<Scope>("current");
  const [status, setStatus] = useState<"loading" | "ok" | "notfound">("loading");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/player/${steamId}`);
      if (res.status === 404) {
        setStatus("notfound");
        return;
      }
      if (res.ok) {
        setProfile(await res.json());
        setStatus("ok");
      }
    } catch {}
  }, [steamId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  const t = profile?.[scope] ?? {};
  const kd = (t.deaths ?? 0) > 0 ? ((t.kills ?? 0) / t.deaths).toFixed(2) : (t.kills ?? 0).toFixed(2);
  const hsRate = (t.kills ?? 0) > 0 ? Math.round(((t.headshots ?? 0) / t.kills) * 100) : 0;
  const gathered = (t.wood ?? 0) + (t.stone ?? 0) + (t.metal_ore ?? 0) + (t.sulfur_ore ?? 0);

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white flex flex-col">
      <NavBar />
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 space-y-6">
        {status === "notfound" && (
          <div className="text-center py-20 text-gray-500">
            Player not found. They may not have any tracked activity yet.
          </div>
        )}

        {status !== "notfound" && (
          <>
            {/* Header */}
            <section className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-6 flex items-center gap-4">
              {profile?.player?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.player.avatar_url} alt="" className="w-16 h-16 rounded-full" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-[#2a2a2a] flex items-center justify-center text-2xl text-gray-500">
                  {profile?.player?.display_name?.[0]?.toUpperCase() ?? "?"}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold truncate">
                  {profile?.player?.display_name ?? "Loading…"}
                </h1>
                <div className="text-xs text-gray-500 mt-1 flex gap-3 flex-wrap">
                  {profile?.player?.last_seen && <span>Last seen {relativeTime(profile.player.last_seen)}</span>}
                  <a
                    href={`https://steamcommunity.com/profiles/${steamId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-white"
                  >
                    Steam profile ↗
                  </a>
                </div>
              </div>

              {/* Scope toggle */}
              <div className="flex items-center gap-1 bg-[#0f0f0f] rounded p-0.5 border border-[#2a2a2a]">
                {(["current", "lifetime"] as Scope[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setScope(s)}
                    className={`text-xs px-3 py-1.5 rounded transition-colors ${
                      scope === s ? "bg-red-600 text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {s === "current" ? "Current Wipe" : "Lifetime"}
                  </button>
                ))}
              </div>
            </section>

            {/* Stat grid */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Rating" value={t.rating ?? 0} accent="text-yellow-400" />
              <Stat label="Kills" value={t.kills ?? 0} />
              <Stat label="Deaths" value={t.deaths ?? 0} />
              <Stat label="K/D" value={kd} />
              <Stat label="Headshots" value={`${t.headshots ?? 0} (${hsRate}%)`} />
              <Stat label="NPC Kills" value={t.npc_kills ?? 0} />
              <Stat label="Heli Hits" value={t.heli_hits ?? 0} />
              <Stat label="Bradley Hits" value={t.bradley_hits ?? 0} />
              <Stat label="Gathered" value={gathered.toLocaleString()} />
              <Stat label="Structures" value={(t.structures_placed ?? 0).toLocaleString()} />
              <Stat label="Rockets / C4" value={`${t.rockets_fired ?? 0} / ${t.c4_thrown ?? 0}`} />
              <Stat label="Playtime" value={formatPlaytime(t.playtime ?? 0)} />
            </section>

            {/* Gathering breakdown */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Wood" value={(t.wood ?? 0).toLocaleString()} accent="text-amber-600" />
              <Stat label="Stone" value={(t.stone ?? 0).toLocaleString()} accent="text-gray-300" />
              <Stat label="Metal Ore" value={(t.metal_ore ?? 0).toLocaleString()} accent="text-blue-400" />
              <Stat label="Sulfur Ore" value={(t.sulfur_ore ?? 0).toLocaleString()} accent="text-yellow-500" />
            </section>

            {/* Kill history */}
            <section className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-4">
              <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">
                Recent Fights
              </h2>
              <KillFeed limit={30} scope={scope} steamId={steamId} emptyText="No fights recorded yet." />
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="bg-[#161616] border border-[#2a2a2a] rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${accent ?? ""}`}>{value}</div>
    </div>
  );
}
