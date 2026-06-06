"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/lib/usePolling";

interface Point {
  ts: number;
  online: number;
}

export default function PopulationChart({ sinceSeconds = 86400 }: { sinceSeconds?: number }) {
  const [points, setPoints] = useState<Point[]>([]);
  const [peak, setPeak] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/population?since=${sinceSeconds}`);
      if (res.ok) {
        const data = await res.json();
        setPoints(data.points ?? []);
        setPeak(data.peak ?? 0);
      }
    } catch {
      // Preserve the most recent graph on transient failures.
    }
  }, [sinceSeconds]);

  usePolling(refresh, 60000);

  if (points.length < 2) {
    return (
      <p className="px-1 py-6 text-center text-xs text-zinc-500">
        Collecting population data. Check back soon.
      </p>
    );
  }

  const width = 600;
  const height = 120;
  const pad = 4;
  const tMin = points[0]?.ts ?? 0;
  const tMax = points[points.length - 1]?.ts ?? 1;
  const tSpan = Math.max(1, tMax - tMin);
  const yMax = Math.max(1, peak);

  const xy = (p: Point) => {
    const x = pad + ((p.ts - tMin) / tSpan) * (width - pad * 2);
    const y = height - pad - (p.online / yMax) * (height - pad * 2);
    return [x, y] as const;
  };

  const line = points.map((p) => xy(p).join(",")).join(" ");
  const [lastX, lastY] = xy(points[points.length - 1]);
  const area = `${pad},${height - pad} ${line} ${lastX},${height - pad}`;
  const current = points[points.length - 1]?.online ?? 0;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-zinc-400">
          Now: <span className="font-semibold text-white">{current}</span>
        </span>
        <span className="text-zinc-500">
          Peak: <span className="font-semibold text-emerald-300">{peak}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-28 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="popfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dc2626" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#dc2626" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#popfill)" />
        <polyline
          points={line}
          fill="none"
          stroke="#ef4444"
          strokeWidth="1.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={lastX} cy={lastY} r="2.5" fill="#ef4444" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
        <span>{fmt(tMin)}</span>
        <span>{fmt(tMax)}</span>
      </div>
    </div>
  );
}

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
