"use client";

import { ExternalLink, Shield, Skull, Star, Trophy, Wallet } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { EmptyState, PageShell, Panel, StatCard } from "@/components/DashboardUi";
import NavBar from "@/components/NavBar";
import KillFeed from "@/components/KillFeed";
import { formatPlaytime, prettyWeapon, relativeTime } from "@/lib/format";
import { usePolling } from "@/lib/usePolling";

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
    money: number;
    rp: number;
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
    } catch {
      // Keep existing profile visible if a refresh fails.
    }
  }, [steamId]);

  usePolling(refresh, 10000);

  const totals = profile?.[scope] ?? {};
  const gathered = (totals.wood ?? 0) + (totals.stone ?? 0) + (totals.metal_ore ?? 0) + (totals.sulfur_ore ?? 0);
  const weapons = scope === "current" ? profile?.weaponsCurrent ?? [] : profile?.weaponsLifetime ?? [];

  return (
    <PageShell className="flex flex-col">
      <NavBar />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6">
        {status === "notfound" && (
          <Panel title="Player">
            <EmptyState>Player not found. They may not have any tracked activity yet.</EmptyState>
          </Panel>
        )}

        {status !== "notfound" && (
          <>
            <section className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950/75 p-5 md:flex-row md:items-center">
              {profile?.player?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.player.avatar_url} alt="" className="h-20 w-20 rounded-lg border border-zinc-800" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-3xl font-black text-zinc-500">
                  {profile?.player?.display_name?.[0]?.toUpperCase() ?? "?"}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Player Profile</p>
                <h1 className="truncate text-3xl font-black tracking-tight text-white">
                  {profile?.player?.display_name ?? "Loading"}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                  {profile?.player?.last_seen && <span>Last seen {relativeTime(profile.player.last_seen)}</span>}
                  {(profile?.player?.money ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 text-emerald-300">
                      <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                      {profile!.player!.money.toLocaleString()}
                    </span>
                  )}
                  {(profile?.player?.rp ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 text-sky-300">
                      <Star className="h-3.5 w-3.5" aria-hidden="true" />
                      {profile!.player!.rp.toLocaleString()} RP
                    </span>
                  )}
                  <a
                    href={`https://steamcommunity.com/profiles/${steamId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-zinc-500 hover:text-white"
                  >
                    Steam profile
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </div>
              </div>

              <div className="inline-flex w-fit items-center gap-1 rounded-lg border border-zinc-800 bg-black/25 p-1">
                {(["current", "lifetime"] as Scope[]).map((item) => (
                  <button
                    key={item}
                    onClick={() => setScope(item)}
                    className={`h-8 rounded-md px-3 text-xs font-semibold transition-colors ${
                      scope === item ? "bg-red-600 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                    }`}
                  >
                    {item === "current" ? "Current Wipe" : "Lifetime"}
                  </button>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard icon={Trophy} label="Rating" value={totals.rating ?? 0} accent="text-yellow-300" />
              <StatCard icon={Skull} label="Boss Kills" value={totals.boss_kills ?? 0} accent="text-red-400" />
              <StatCard label="Heli Kills" value={totals.heli_kills ?? 0} accent="text-red-300" />
              <StatCard icon={Shield} label="Bradley" value={totals.bradley_kills ?? 0} accent="text-orange-300" />
              <StatCard label="Animals" value={totals.animal_kills ?? 0} accent="text-emerald-300" />
              <StatCard label="Scientists" value={totals.scientist_kills ?? 0} accent="text-cyan-300" />
              <StatCard label="Other NPCs" value={totals.npc_kills ?? 0} />
              <StatCard label="Gathered" value={gathered.toLocaleString()} />
              <StatCard label="Structures" value={(totals.structures_placed ?? 0).toLocaleString()} />
              <StatCard label="Playtime" value={formatPlaytime(totals.playtime ?? 0)} />
              <StatCard label="PvP Kills" value={totals.kills ?? 0} />
              <StatCard label="Deaths" value={totals.deaths ?? 0} />
            </section>

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Wood" value={(totals.wood ?? 0).toLocaleString()} accent="text-amber-600" />
              <StatCard label="Stone" value={(totals.stone ?? 0).toLocaleString()} accent="text-zinc-300" />
              <StatCard label="Metal Ore" value={(totals.metal_ore ?? 0).toLocaleString()} accent="text-sky-300" />
              <StatCard label="Sulfur Ore" value={(totals.sulfur_ore ?? 0).toLocaleString()} accent="text-yellow-300" />
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel title="Top Weapons">
                <WeaponBars weapons={weapons} />
              </Panel>

              <Panel title="Recent Fights">
                <KillFeed limit={30} scope={scope} steamId={steamId} emptyText="No fights recorded yet." />
              </Panel>
            </section>
          </>
        )}
      </main>
    </PageShell>
  );
}

function WeaponBars({ weapons }: { weapons: Weapon[] }) {
  if (weapons.length === 0) {
    return <p className="py-3 text-xs text-zinc-500">No weapon kills recorded yet.</p>;
  }
  const max = Math.max(...weapons.map((w) => w.kills));
  return (
    <ul className="flex flex-col gap-3">
      {weapons.map((w) => (
        <li key={w.weapon} className="text-xs">
          <div className="mb-1 flex justify-between gap-3">
            <span className="truncate font-semibold text-zinc-300">{prettyWeapon(w.weapon)}</span>
            <span className="text-zinc-500">{w.kills}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-black/50">
            <div
              className="h-full rounded bg-red-600"
              style={{ width: `${Math.round((w.kills / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
