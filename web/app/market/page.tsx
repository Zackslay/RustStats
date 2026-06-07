"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useState } from "react";
import NavBar from "@/components/NavBar";
import { PageShell } from "@/components/DashboardUi";
import { compact } from "@/lib/format";
import { usePolling } from "@/lib/usePolling";

interface Trend {
  shortname: string;
  trades: number;
  volume: number;
  lastPrice: number;
  avgPrice: number;
  weekAvg: number;
  changePct: number;
  spark: number[];
}

function prettyItem(s: string): string {
  return s
    .split(".")
    .join(" ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length === 0) return <div className="h-6 w-20" />;
  const w = 80;
  const h = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`)
    .join(" ");
  const up = data[data.length - 1] >= data[0];
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke={up ? "#34d399" : "#f87171"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Change({ pct }: { pct: number }) {
  const flat = Math.abs(pct) < 0.5;
  const up = pct > 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const color = flat ? "text-zinc-400" : up ? "text-emerald-400" : "text-red-400";
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {flat ? "—" : `${up ? "+" : ""}${pct.toFixed(1)}%`}
    </span>
  );
}

export default function MarketPage() {
  const [trends, setTrends] = useState<Trend[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/market");
      if (res.ok) {
        const data = await res.json();
        setTrends(data.trends ?? []);
      }
    } catch {}
  }, []);

  usePolling(refresh, 30000);

  return (
    <PageShell>
      <NavBar />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
        <section className="rounded-lg border border-zinc-800 bg-zinc-950/75 p-5">
          <h1 className="text-2xl font-black tracking-tight text-white">Commodity Market</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Live player-market prices. As the server floods an item its price falls;
            scarce goods climb. Trades from the last 7 days. Sell in-game with{" "}
            <span className="font-mono text-amber-300">/market sell</span>.
          </p>
        </section>

        <section className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/75">
          <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1.2fr] gap-2 border-b border-zinc-800 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            <div>Commodity</div>
            <div className="text-right">Price (RP/ea)</div>
            <div className="text-right">7d change</div>
            <div className="text-right">Volume</div>
            <div className="text-right">Trend</div>
          </div>

          {trends === null && (
            <div className="px-4 py-10 text-center text-sm text-zinc-500">Loading…</div>
          )}
          {trends !== null && trends.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-zinc-500">
              No trades yet. Once players start selling on the market, prices appear here.
            </div>
          )}

          {trends?.map((t) => (
            <div
              key={t.shortname}
              className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1.2fr] items-center gap-2 border-b border-zinc-900 px-4 py-3 text-sm last:border-0 hover:bg-zinc-900/40"
            >
              <div className="font-semibold text-white">{prettyItem(t.shortname)}</div>
              <div className="text-right font-mono text-amber-300">
                {t.lastPrice.toFixed(t.lastPrice < 10 ? 1 : 0)}
              </div>
              <div className="text-right">
                <Change pct={t.changePct} />
              </div>
              <div className="text-right font-mono text-zinc-400">{compact(t.volume)}</div>
              <div className="flex justify-end">
                <Sparkline data={t.spark} />
              </div>
            </div>
          ))}
        </section>
      </main>
    </PageShell>
  );
}
