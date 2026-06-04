"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { prettyWeapon, relativeTime } from "@/lib/format";

interface KillRow {
  id: number;
  weapon: string;
  headshot: boolean;
  ts: number;
  killer_id: string | null;
  killer_name: string | null;
  victim_id: string | null;
  victim_name: string | null;
}

interface Props {
  limit?: number;
  scope?: "current" | "lifetime";
  steamId?: string; // filter to a single player's kills/deaths
  refreshMs?: number;
  emptyText?: string;
}

export default function KillFeed({
  limit = 25,
  scope = "current",
  steamId,
  refreshMs = 5000,
  emptyText = "No kills logged yet.",
}: Props) {
  const [kills, setKills] = useState<KillRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchKills = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(limit), wipe: scope });
      if (steamId) params.set("steamId", steamId);
      const res = await fetch(`/api/kills?${params}`);
      if (res.ok) {
        const data = await res.json();
        setKills(data.kills ?? []);
      }
    } finally {
      setLoaded(true);
    }
  }, [limit, scope, steamId]);

  useEffect(() => {
    fetchKills();
    const id = setInterval(fetchKills, refreshMs);
    return () => clearInterval(id);
  }, [fetchKills, refreshMs]);

  if (loaded && kills.length === 0) {
    return <p className="text-gray-600 text-xs px-1 py-2">{emptyText}</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-[#1e1e1e]">
      {kills.map((k) => (
        <li key={k.id} className="flex items-center gap-1.5 py-1.5 text-xs">
          <PlayerName id={k.killer_id} name={k.killer_name} className="text-emerald-400" />
          <span className="text-gray-500 shrink-0">
            {k.headshot ? "🎯" : "🔫"} {prettyWeapon(k.weapon)}
          </span>
          <PlayerName id={k.victim_id} name={k.victim_name} className="text-red-400" />
          <span className="ml-auto text-gray-600 shrink-0">{relativeTime(k.ts)}</span>
        </li>
      ))}
    </ul>
  );
}

function PlayerName({
  id,
  name,
  className,
}: {
  id: string | null;
  name: string | null;
  className: string;
}) {
  const label = name ?? "—";
  if (!id) return <span className={`${className} truncate max-w-[90px]`}>{label}</span>;
  return (
    <Link
      href={`/player/${id}`}
      className={`${className} truncate max-w-[90px] hover:underline`}
      title={label}
    >
      {label}
    </Link>
  );
}
