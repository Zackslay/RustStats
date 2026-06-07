"use client";

import { Award, Bomb, Building2, Crosshair, ExternalLink, Hammer, HeartPulse, Shield, Skull, Star, Trophy, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

  usePolling(refresh, 60000);

  const totals = profile?.[scope] ?? {};
  const gathered = (totals.wood ?? 0) + (totals.stone ?? 0) + (totals.metal_ore ?? 0) + (totals.sulfur_ore ?? 0);
  const weapons = scope === "current" ? profile?.weaponsCurrent ?? [] : profile?.weaponsLifetime ?? [];
  const badges = buildBadges(totals, gathered);

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
                  {profile?.player?.first_seen ? (
                    <span title={new Date(profile.player.first_seen * 1000).toLocaleString()}>
                      Joined {new Date(profile.player.first_seen * 1000).toLocaleDateString()}
                    </span>
                  ) : null}
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

            <Panel title="Earned Badges">
              {badges.length === 0 ? (
                <p className="py-3 text-xs text-zinc-500">No badges earned yet. Boss kills, event clears, gathering, building, and playtime unlock profile badges.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {badges.map((badge) => (
                    <BadgeCard key={badge.title} badge={badge} />
                  ))}
                </div>
              )}
            </Panel>

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

interface Badge {
  title: string;
  detail: string;
  icon: LucideIcon;
  tone: string;
}

function buildBadges(totals: Totals, gathered: number): Badge[] {
  const badges: Badge[] = [];
  const bossKills = totals.boss_kills ?? 0;
  const eventKills = (totals.heli_kills ?? 0) + (totals.bradley_kills ?? 0);
  const npcKills = (totals.scientist_kills ?? 0) + (totals.npc_kills ?? 0);
  const explosives = (totals.rockets_fired ?? 0) + (totals.c4_thrown ?? 0) + (totals.satchels ?? 0);
  const playHours = Math.floor((totals.playtime ?? 0) / 3600);

  if (bossKills > 0) badges.push({ title: "Boss Slayer", detail: `${bossKills} AP boss kills`, icon: Skull, tone: "border-red-800 bg-red-950/25 text-red-300" });
  if (eventKills >= 3) badges.push({ title: "Event Hunter", detail: `${eventKills} heli/bradley clears`, icon: Shield, tone: "border-orange-800 bg-orange-950/20 text-orange-300" });
  if (npcKills >= 100) badges.push({ title: "NPC Reaper", detail: `${npcKills.toLocaleString()} NPC kills`, icon: Crosshair, tone: "border-cyan-800 bg-cyan-950/20 text-cyan-300" });
  if (gathered >= 100000) badges.push({ title: "Resource Baron", detail: `${gathered.toLocaleString()} gathered`, icon: Hammer, tone: "border-emerald-800 bg-emerald-950/20 text-emerald-300" });
  if ((totals.structures_placed ?? 0) >= 500) badges.push({ title: "Base Architect", detail: `${(totals.structures_placed ?? 0).toLocaleString()} structures`, icon: Building2, tone: "border-sky-800 bg-sky-950/20 text-sky-300" });
  if (explosives >= 25) badges.push({ title: "Demolition Crew", detail: `${explosives} explosives used`, icon: Bomb, tone: "border-yellow-800 bg-yellow-950/20 text-yellow-300" });
  if (playHours >= 24) badges.push({ title: "Wipe Grinder", detail: `${playHours}h playtime`, icon: Trophy, tone: "border-purple-800 bg-purple-950/20 text-purple-300" });
  if ((totals.deaths ?? 0) === 0 && (totals.playtime ?? 0) > 7200) badges.push({ title: "Still Standing", detail: "No deaths with 2h+ playtime", icon: HeartPulse, tone: "border-zinc-700 bg-zinc-950 text-zinc-300" });
  if (badges.length === 0 && (totals.rating ?? 0) > 0) badges.push({ title: "On The Board", detail: `${totals.rating} rating earned`, icon: Award, tone: "border-zinc-700 bg-zinc-950 text-zinc-300" });

  return badges;
}

function BadgeCard({ badge }: { badge: Badge }) {
  const Icon = badge.icon;
  return (
    <div className={`flex items-center gap-3 rounded-lg border p-3 ${badge.tone}`}>
      <span className="flex h-10 w-10 items-center justify-center rounded-md border border-current/30 bg-black/20">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-black text-white">{badge.title}</span>
        <span className="block truncate text-xs text-zinc-500">{badge.detail}</span>
      </span>
    </div>
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
