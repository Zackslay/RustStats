"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import NavBar from "@/components/NavBar";
import KillFeed from "@/components/KillFeed";
import { formatPlaytime, prettyWeapon, relativeTime } from "@/lib/format";

type Totals = Record<string, number>;
interface Weapon {
  weapon: string;
  kills: number;
}
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
  weaponsCurrent: Weapon[];
  weaponsLifetime: Weapon[];
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

            {/* Stat grid (PvE-focused) */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Rating" value={t.rating ?? 0} accent="text-yellow-400" />
              <Stat label="Boss Kills" value={t.boss_kills ?? 0} accent="text-red-500" />
              <Stat label="Heli Kills" value={t.heli_kills ?? 0} accent="text-red-400" />
              <Stat label="Bradley Kills" value={t.bradley_kills ?? 0} accent="text-orange-400" />
              <Stat label="Animals" value={t.animal_kills ?? 0} accent="text-green-400" />
              <Stat label="Scientists" value={t.scientist_kills ?? 0} accent="text-cyan-400" />
              <Stat label="Other NPCs" value={t.npc_kills ?? 0} />
              <Stat label="Gathered" value={gathered.toLocaleString()} />
              <Stat label="Structures" value={(t.structures_placed ?? 0).toLocaleString()} />
              <Stat label="Playtime" value={formatPlaytime(t.playtime ?? 0)} />
              <Stat label="PvP Kills" value={t.kills ?? 0} />
              <Stat label="Deaths" value={t.deaths ?? 0} />
              <Stat label="Rocket/C4/Satchel" value={`${t.rockets_fired ?? 0}/${t.c4_thrown ?? 0}/${t.satchels ?? 0}`} />
            </section>

            {/* Gathering breakdown */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Wood" value={(t.wood ?? 0).toLocaleString()} accent="text-amber-600" />
              <Stat label="Stone" value={(t.stone ?? 0).toLocaleString()} accent="text-gray-300" />
              <Stat label="Metal Ore" value={(t.metal_ore ?? 0).toLocaleString()} accent="text-blue-400" />
              <Stat label="Sulfur Ore" value={(t.sulfur_ore ?? 0).toLocaleString()} accent="text-yellow-500" />
            </section>

            {/* Weapons + kill history */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-4">
                <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">
                  Top Weapons
                </h2>
                <WeaponBars weapons={scope === "current" ? profile?.weaponsCurrent ?? [] : profile?.weaponsLifetime ?? []} />
              </div>

              <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-4">
                <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">
                  Recent Fights
                </h2>
                <KillFeed limit={30} scope={scope} steamId={steamId} emptyText="No fights recorded yet." />
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function WeaponBars({ weapons }: { weapons: Weapon[] }) {
  if (weapons.length === 0) {
    return <p className="text-gray-600 text-xs py-2">No weapon kills recorded yet.</p>;
  }
  const max = Math.max(...weapons.map((w) => w.kills));
  return (
    <ul className="flex flex-col gap-2">
      {weapons.map((w) => (
        <li key={w.weapon} className="text-xs">
          <div className="flex justify-between mb-0.5">
            <span className="text-gray-300">{prettyWeapon(w.weapon)}</span>
            <span className="text-gray-500">{w.kills}</span>
          </div>
          <div className="h-1.5 bg-[#0f0f0f] rounded overflow-hidden">
            <div
              className="h-full bg-red-600"
              style={{ width: `${Math.round((w.kills / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
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
