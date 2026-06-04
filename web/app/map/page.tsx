"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { GameState, ActiveEvent } from "@/lib/gameState";
import KillFeed from "@/components/KillFeed";

import type { DeathMarker } from "@/components/LiveMap";

const LiveMap = dynamic(() => import("@/components/LiveMap"), { ssr: false });

const POLL_INTERVAL = 2500; // ms

const EVENT_COLORS: Record<string, string> = {
  heli: "border-red-500 text-red-400",
  bradley: "border-orange-500 text-orange-400",
  cargo: "border-blue-400 text-blue-300",
  chinook: "border-yellow-400 text-yellow-300",
};

export default function MapPage() {
  const [state, setState] = useState<GameState & { wipe?: Record<string, unknown> | null }>({
    server: null,
    players: {},
    events: [],
    lastUpdate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [deaths, setDeaths] = useState<DeathMarker[]>([]);
  const [showDeaths, setShowDeaths] = useState(true);

  const mapSize = (state.wipe?.map_size as number) ?? state.server?.mapSize ?? 3500;

  // ── Map calibration (aligns markers to the rendered map image) ────────────
  // world.rendermap bakes in a fixed ~500-unit ocean border, so the inset
  // fraction is size-dependent: margin = 500 / (size + 1000) (fits 3750→0.105,
  // 4500→0.091). Per-size tweaks are remembered; the slider fine-tunes any map.
  const [showCal, setShowCal] = useState(false);
  const [margin, setMargin] = useState(() => defaultMargin(3500));
  const [offX, setOffX] = useState(0);
  const [offZ, setOffZ] = useState(10);
  const [calibTouched, setCalibTouched] = useState(false);

  // Load saved calibration for this map size (or the size-aware default) when
  // the map size changes, unless the user has manually tuned this session.
  useEffect(() => {
    if (calibTouched) return;
    try {
      const raw = localStorage.getItem(`mapCalib:${mapSize}`);
      if (raw) {
        const c = JSON.parse(raw);
        setMargin(c.margin ?? defaultMargin(mapSize));
        setOffX(c.offX ?? 0);
        setOffZ(c.offZ ?? 10);
        return;
      }
    } catch {}
    setMargin(defaultMargin(mapSize));
    setOffX(0);
    setOffZ(10);
  }, [mapSize, calibTouched]);

  const tuneCalib = useCallback(
    (next: { margin?: number; offX?: number; offZ?: number }) => {
      setCalibTouched(true);
      const m = next.margin ?? margin;
      const x = next.offX ?? offX;
      const z = next.offZ ?? offZ;
      if (next.margin !== undefined) setMargin(next.margin);
      if (next.offX !== undefined) setOffX(next.offX);
      if (next.offZ !== undefined) setOffZ(next.offZ);
      try {
        localStorage.setItem(`mapCalib:${mapSize}`, JSON.stringify({ margin: m, offX: x, offZ: z }));
      } catch {}
    },
    [margin, offX, offZ, mapSize]
  );

  const resetCalib = useCallback(() => {
    setCalibTouched(false);
    setMargin(defaultMargin(mapSize));
    setOffX(0);
    setOffZ(10);
    try {
      localStorage.removeItem(`mapCalib:${mapSize}`);
    } catch {}
  }, [mapSize]);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/gamestate");
      if (res.ok) {
        const data = await res.json();
        setState(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchState]);

  // Recent kill locations (last 15 min) for death markers.
  const fetchDeaths = useCallback(async () => {
    try {
      const res = await fetch("/api/kills?since=900&limit=150");
      if (res.ok) {
        const data = await res.json();
        setDeaths(data.kills ?? []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchDeaths();
    const id = setInterval(fetchDeaths, 10000);
    return () => clearInterval(id);
  }, [fetchDeaths]);

  // The plugin renders the map (world.rendermap) and uploads it to /api/map.
  // Empty mapUrl => use our self-hosted render. A non-localhost override is used
  // directly; legacy localhost values still fall back to the proxy.
  const rawMapUrl = state.server?.mapUrl ?? "";
  const externalUrl =
    rawMapUrl && !rawMapUrl.startsWith("http://localhost") ? rawMapUrl : "";
  // Cache-bust per wipe so the overlay picks up the render once it's uploaded.
  const mapUrl =
    externalUrl ||
    `/api/map${state.server?.wipeDate ? `?v=${state.server.wipeDate}` : ""}`;
  const onlinePlayers = Object.values(state.players).filter((p) => p.online);
  const server = state.server;

  return (
    <div className="flex flex-col h-screen bg-[#0f0f0f] text-white overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-[#161616] border-b border-[#2a2a2a] shrink-0">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm font-semibold tracking-wide">LIVE MAP</span>
          {server && (
            <span className="text-xs text-gray-400 ml-2">{server.name}</span>
          )}
        </div>
        <div className="flex items-center gap-6 text-xs text-gray-400">
          <span>
            <span className="text-white font-medium">{onlinePlayers.length}</span>{" "}
            online
            {server?.maxPlayers ? ` / ${server.maxPlayers}` : ""}
          </span>
          {server?.wipeDate && (
            <span>
              Wiped{" "}
              <span className="text-white">
                {formatAge(server.wipeDate)}
              </span>{" "}
              ago
            </span>
          )}
          <span className="text-gray-600">
            {state.lastUpdate
              ? new Date(state.lastUpdate).toLocaleTimeString()
              : "—"}
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 bg-[#161616] border-r border-[#2a2a2a] flex flex-col overflow-hidden">
          {/* Active events */}
          {state.events.length > 0 && (
            <div className="p-3 border-b border-[#2a2a2a]">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">
                Active Events
              </p>
              <div className="flex flex-col gap-1">
                {state.events.map((ev: ActiveEvent, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 text-xs border rounded px-2 py-1 bg-black/30 ${EVENT_COLORS[ev.type] ?? "border-gray-500 text-gray-400"}`}
                  >
                    <span className="font-semibold">{ev.label}</span>
                    {ev.health !== undefined && (
                      <span className="ml-auto opacity-70">
                        {ev.health} HP
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Online players */}
          <div className="p-3 flex-1 overflow-y-auto">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">
              Players ({onlinePlayers.length})
            </p>
            <div className="flex flex-col gap-1">
              {onlinePlayers.map((p) => (
                <div
                  key={p.steamId}
                  className="flex items-center gap-2 text-xs py-1 border-b border-[#222] last:border-0"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      background: p.teamId
                        ? teamColor(p.teamId)
                        : "#4ade80",
                    }}
                  />
                  <Link
                    href={`/player/${p.steamId}`}
                    className="truncate flex-1 hover:text-red-400 transition-colors"
                  >
                    {p.name}
                  </Link>
                  <span className="text-gray-500">{p.health}hp</span>
                </div>
              ))}
              {onlinePlayers.length === 0 && (
                <p className="text-gray-600 text-xs">No players online</p>
              )}
            </div>
          </div>

          {/* Recent kills */}
          <div className="p-3 border-t border-[#2a2a2a] max-h-64 overflow-y-auto shrink-0">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">
              Recent Kills
            </p>
            <KillFeed limit={12} scope="current" />
          </div>
        </aside>

        {/* Map */}
        <main className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0f0f0f] z-10">
              <div className="text-gray-400 animate-pulse">Loading map...</div>
            </div>
          )}
          <LiveMap
            mapSize={mapSize}
            mapImageUrl={mapUrl}
            state={state}
            margin={margin}
            offX={offX}
            offZ={offZ}
            deaths={showDeaths ? deaths : []}
          />

          {/* Top-right controls */}
          <div className="absolute top-2 right-2 z-[1000] flex gap-1">
            <button
              onClick={() => setShowDeaths((v) => !v)}
              className={`text-[11px] px-2 py-1 rounded border ${
                showDeaths
                  ? "bg-red-600/80 border-red-500 text-white"
                  : "bg-black/70 border-[#333] text-gray-300 hover:text-white"
              }`}
              title="Toggle recent death markers (last 15 min)"
            >
              💀 Deaths
            </button>
            <button
              onClick={() => setShowCal((v) => !v)}
              className="text-[11px] px-2 py-1 rounded bg-black/70 border border-[#333] text-gray-300 hover:text-white"
            >
              {showCal ? "Close" : "Align ⚙"}
            </button>
          </div>

          {showCal && (
            <div className="absolute top-10 right-2 z-[1000] w-60 bg-[#111]/95 border border-[#333] rounded-lg p-3 text-xs space-y-3">
              <p className="text-gray-400 leading-snug">
                Drag until monument labels sit on the monuments, then send these
                3 numbers.
              </p>
              <CalSlider label="Margin" value={margin} min={-0.1} max={0.25} step={0.002} onChange={(v) => tuneCalib({ margin: v })} format={(v) => v.toFixed(3)} />
              <CalSlider label="Offset X" value={offX} min={-600} max={600} step={5} onChange={(v) => tuneCalib({ offX: v })} format={(v) => v.toFixed(0)} />
              <CalSlider label="Offset Z" value={offZ} min={-600} max={600} step={5} onChange={(v) => tuneCalib({ offZ: v })} format={(v) => v.toFixed(0)} />
              <div className="flex items-center justify-between pt-1">
                <code className="text-[10px] text-emerald-400">
                  {`m=${margin.toFixed(3)} x=${offX} z=${offZ}`}
                </code>
                <button
                  onClick={resetCalib}
                  className="text-[10px] text-gray-400 hover:text-white underline"
                >
                  reset
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// world.rendermap bakes in a fixed ~500-unit ocean border around the playable
// area, so the inset fraction shrinks as the map grows.
function defaultMargin(mapSize: number): number {
  return 500 / (mapSize + 1000);
}

function CalSlider({
  label, value, min, max, step, onChange, format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <label className="block">
      <span className="flex justify-between text-gray-300">
        <span>{label}</span>
        <span className="text-gray-500">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </label>
  );
}

function formatAge(unixTs: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixTs;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 48) return `${Math.floor(h / 24)}d`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function teamColor(teamId: number): string {
  const colors = [
    "#f87171", "#fb923c", "#facc15", "#a3e635",
    "#34d399", "#22d3ee", "#818cf8", "#e879f9",
  ];
  return colors[teamId % colors.length];
}
