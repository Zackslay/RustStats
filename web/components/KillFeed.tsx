"use client";

import { Crosshair, Swords } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { prettyWeapon, relativeTime } from "@/lib/format";
import { usePolling } from "@/lib/usePolling";

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
  steamId?: string;
  refreshMs?: number;
  emptyText?: string;
}

export default function KillFeed({
  limit = 25,
  scope = "current",
  steamId,
  refreshMs = 60000,
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

  usePolling(fetchKills, refreshMs);

  if (loaded && kills.length === 0) {
    return <p className="px-1 py-3 text-xs text-zinc-500">{emptyText}</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-zinc-900">
      {kills.map((k) => {
        const WeaponIcon = k.headshot ? Crosshair : Swords;
        return (
          <li key={k.id} className="flex items-center gap-2 py-2 text-xs">
            <PlayerName id={k.killer_id} name={k.killer_name} className="text-emerald-300" />
            <span className="inline-flex min-w-0 shrink-0 items-center gap-1 text-zinc-500">
              <WeaponIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden max-w-[110px] truncate sm:inline">{prettyWeapon(k.weapon)}</span>
            </span>
            <PlayerName id={k.victim_id} name={k.victim_name} className="text-red-300" />
            <span className="ml-auto shrink-0 text-zinc-600">{relativeTime(k.ts)}</span>
          </li>
        );
      })}
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
  const label = name ?? "-";
  if (!id) return <span className={`${className} max-w-[90px] truncate font-semibold`}>{label}</span>;
  return (
    <Link
      href={`/player/${id}`}
      className={`${className} max-w-[90px] truncate font-semibold hover:text-white`}
      title={label}
    >
      {label}
    </Link>
  );
}
