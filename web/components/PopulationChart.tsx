"use client";

import { useCallback, useEffect, useState } from "react";

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
    } catch {}
  }, [sinceSeconds]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, [refresh]);

  if (points.length < 2) {
    return (
      <p className="text-gray-600 text-xs px-1 py-6 text-center">
        Collecting population data… check back soon.
      </p>
    );
  }

  const W = 600;
  const H = 120;
  const pad = 4;
  const tMin = points[0]?.ts ?? 0;
  const tMax = points[points.length - 1]?.ts ?? 1;
  const tSpan = Math.max(1, tMax - tMin);
  const yMax = Math.max(1, peak);

  const xy = (p: Point) => {
    const x = pad + ((p.ts - tMin) / tSpan) * (W - pad * 2);
    const y = H - pad - (p.online / yMax) * (H - pad * 2);
    return [x, y] as const;
  };

  const line = points.map((p) => xy(p).join(",")).join(" ");
  const [lastX, lastY] = xy(points[points.length - 1]);
  const area = `${pad},${H - pad} ${line} ${lastX},${H - pad}`;
  const current = points[points.length - 1]?.online ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 text-xs">
        <span className="text-gray-400">
          Now: <span className="text-white font-semibold">{current}</span>
        </span>
        <span className="text-gray-500">
          Peak: <span className="text-emerald-400 font-semibold">{peak}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28" preserveAspectRatio="none">
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
      <div className="flex justify-between text-[10px] text-gray-600 mt-1">
        <span>{fmt(tMin)}</span>
        <span>{fmt(tMax)}</span>
      </div>
    </div>
  );
}

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
