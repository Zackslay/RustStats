"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { GameState, ActiveEvent } from "@/lib/gameState";

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

  // ── Map calibration (aligns markers to the rendered map image) ────────────
  const [showCal, setShowCal] = useState(false);
  const [margin, setMargin] = useState(0);
  const [offX, setOffX] = useState(0);
  const [offZ, setOffZ] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("mapCalib");
      if (raw) {
        const c = JSON.parse(raw);
        setMargin(c.margin ?? 0);
        setOffX(c.offX ?? 0);
        setOffZ(c.offZ ?? 0);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("mapCalib", JSON.stringify({ margin, offX, offZ }));
    } catch {}
  }, [margin, offX, offZ]);

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

  const mapSize = (state.wipe?.map_size as number) ?? state.server?.mapSize ?? 3500;
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
                  <span className="truncate flex-1">{p.name}</span>
                  <span className="text-gray-500">{p.health}hp</span>
                </div>
              ))}
              {onlinePlayers.length === 0 && (
                <p className="text-gray-600 text-xs">No players online</p>
              )}
            </div>
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
          />

          {/* Calibration toggle */}
          <button
            onClick={() => setShowCal((v) => !v)}
            className="absolute top-2 right-2 z-[1000] text-[11px] px-2 py-1 rounded bg-black/70 border border-[#333] text-gray-300 hover:text-white"
          >
            {showCal ? "Close" : "Align ⚙"}
          </button>

          {showCal && (
            <div className="absolute top-10 right-2 z-[1000] w-60 bg-[#111]/95 border border-[#333] rounded-lg p-3 text-xs space-y-3">
              <p className="text-gray-400 leading-snug">
                Drag until monument labels sit on the monuments, then send these
                3 numbers.
              </p>
              <CalSlider label="Margin" value={margin} min={-0.1} max={0.25} step={0.002} onChange={setMargin} format={(v) => v.toFixed(3)} />
              <CalSlider label="Offset X" value={offX} min={-600} max={600} step={5} onChange={setOffX} format={(v) => v.toFixed(0)} />
              <CalSlider label="Offset Z" value={offZ} min={-600} max={600} step={5} onChange={setOffZ} format={(v) => v.toFixed(0)} />
              <div className="flex items-center justify-between pt-1">
                <code className="text-[10px] text-emerald-400">
                  {`m=${margin.toFixed(3)} x=${offX} z=${offZ}`}
                </code>
                <button
                  onClick={() => { setMargin(0); setOffX(0); setOffZ(0); }}
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
