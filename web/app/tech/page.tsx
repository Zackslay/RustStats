"use client";

import { Building2, Crosshair, Hammer, Leaf, Lock, Skull, Unlock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useState } from "react";
import NavBar from "@/components/NavBar";
import { PageShell, Panel } from "@/components/DashboardUi";
import { compact } from "@/lib/format";
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

interface Node {
  key: keyof Totals;
  title: string;
  desc: string;
  goal: number;
  perk: string;
  icon: LucideIcon;
  accent: string;
}

// Community goals — the whole server contributes toward these each wipe.
const NODES: Node[] = [
  { key: "npcKills", title: "Scientist Purge", desc: "NPCs killed server-wide", goal: 2000, perk: "Unlocks a server-wide scrap surge event", icon: Crosshair, accent: "text-cyan-300" },
  { key: "animalKills", title: "The Great Hunt", desc: "Animals hunted", goal: 1000, perk: "Hunting yields bonus rewards", icon: Leaf, accent: "text-emerald-300" },
  { key: "bossKills", title: "Boss Slayers", desc: "Bosses defeated", goal: 50, perk: "Tougher bosses with better loot", icon: Skull, accent: "text-red-400" },
  { key: "gathered", title: "Industrial Age", desc: "Resources gathered", goal: 1_000_000, perk: "Faster smelting for everyone", icon: Hammer, accent: "text-amber-400" },
  { key: "structures", title: "Civilization", desc: "Structures built", goal: 5000, perk: "Server-wide upkeep discount", icon: Building2, accent: "text-sky-300" },
];

export default function TechTreePage() {
  const [totals, setTotals] = useState<Totals | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      if (res.ok) setTotals(await res.json());
    } catch {}
  }, []);

  usePolling(refresh, 15000);

  const unlocked = NODES.filter((n) => totals && totals[n.key] >= n.goal).length;

  return (
    <PageShell>
      <NavBar />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
        <section className="rounded-lg border border-zinc-800 bg-zinc-950/75 p-5">
          <h1 className="text-2xl font-black tracking-tight text-white">Community Tech Tree</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Every player contributes to these server-wide goals each wipe. Hit a milestone and the whole
            server unlocks the perk. <span className="text-emerald-300">{unlocked}/{NODES.length} unlocked.</span>
          </p>
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {NODES.map((n) => {
            const value = totals ? totals[n.key] : 0;
            const pct = Math.min(100, Math.round((value / n.goal) * 100));
            const done = value >= n.goal;
            const Icon = n.icon;
            return (
              <Panel key={n.key} title={n.title}>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 rounded-md border border-zinc-800 bg-black/30 p-2 ${n.accent}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-zinc-300">{n.desc}</span>
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold ${done ? "text-emerald-300" : "text-zinc-500"}`}>
                        {done ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                        {done ? "Unlocked" : `${pct}%`}
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded bg-black/50">
                      <div className={`h-full ${done ? "bg-emerald-500" : "bg-red-600"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
                      <span>{compact(value)} / {compact(n.goal)}</span>
                    </div>
                    <p className={`mt-2 text-xs ${done ? "text-emerald-300" : "text-zinc-500"}`}>🎁 {n.perk}</p>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      </main>
    </PageShell>
  );
}
