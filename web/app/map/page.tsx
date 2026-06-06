"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { GameState, ActiveEvent, Monument } from "@/lib/gameState";
import KillFeed from "@/components/KillFeed";
import { gridFromXZ } from "@/lib/format";

import type { DeathMarker } from "@/components/LiveMap";

const LiveMap = dynamic(() => import("@/components/LiveMap"), { ssr: false });

const POLL_INTERVAL = 2500; // ms

const EVENT_COLORS: Record<string, string> = {
  heli: "border-red-500 text-red-400",
  bradley: "border-orange-500 text-orange-400",
  cargo: "border-blue-400 text-blue-300",
  chinook: "border-yellow-400 text-yellow-300",
  boss: "border-red-600 text-red-500",
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

  // ── Pin-align (exact, ground-control-point calibration) ───────────────────
  // Pin two monuments to their real spots on the rendered map and solve the
  // exact margin/offX/offZ. rendermap is a square render of a square world, so
  // scale is uniform — two points fully determine scale + offset.
  type Pin = { lat: number; lng: number };
  const [pinPhase, setPinPhase] = useState<"off" | "pickA" | "clickA" | "pickB" | "clickB">("off");
  const [pinMonA, setPinMonA] = useState<Monument | null>(null);
  const [pinMonB, setPinMonB] = useState<Monument | null>(null);
  const [pinA, setPinA] = useState<Pin | null>(null);
  const [pinError, setPinError] = useState("");
  const calibrating = pinPhase === "clickA" || pinPhase === "clickB";

  const cancelPin = useCallback(() => {
    setPinPhase("off");
    setPinMonA(null);
    setPinMonB(null);
    setPinA(null);
  }, []);

  const onCalibrate = useCallback(
    (lat: number, lng: number) => {
      if (pinPhase === "clickA") {
        setPinA({ lat, lng });
        setPinPhase("pickB");
      } else if (pinPhase === "clickB" && pinMonA && pinMonB && pinA) {
        const a = pinMonA, b = pinMonB, p1 = pinA, p2 = { lat, lng };
        const dx = b.x - a.x, dz = b.z - a.z;
        if (Math.abs(dx) < 150 || Math.abs(dz) < 150) {
          setPinError("Pick two monuments far apart in BOTH directions (opposite corners work best).");
          cancelPin();
          return;
        }
        const sx = (p2.lng - p1.lng) / dx;
        const sz = (p2.lat - p1.lat) / dz;
        const s = (sx + sz) / 2; // uniform scale (normalized units per world meter)
        if (!(s > 0)) {
          setPinError("Calibration failed — click the exact monument centers and try again.");
          cancelPin();
          return;
        }
        const half = mapSize / 2;
        const m = (1 - s * mapSize) / 2;
        const newOffX = (p1.lng - m) / s - a.x - half;
        const newOffZ = (p1.lat - m) / s - a.z - half;
        setCalibTouched(true);
        setMargin(m);
        setOffX(newOffX);
        setOffZ(newOffZ);
        try {
          localStorage.setItem(`mapCalib:${mapSize}`, JSON.stringify({ margin: m, offX: newOffX, offZ: newOffZ }));
        } catch {}
        setPinError("");
        cancelPin();
      }
    },
    [pinPhase, pinMonA, pinMonB, pinA, mapSize, cancelPin]
  );

  const monuments = state.server?.monuments ?? [];
  const bossEvent = state.events.find((e) => e.type === "boss");

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
          {bossEvent && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-600/90 border border-red-400 text-white text-xs font-semibold shadow-lg animate-pulse">
              <span>💀 BOSS ACTIVE</span>
              <span className="opacity-90">{bossEvent.label}</span>
              <span className="opacity-75">· {gridFromXZ(bossEvent.x, bossEvent.z, mapSize)}</span>
              {bossEvent.health !== undefined && (
                <span className="opacity-75">· {bossEvent.health} HP</span>
              )}
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
            calibrating={calibrating}
            onCalibrate={onCalibrate}
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
            <div className="absolute top-10 right-2 z-[1000] w-64 bg-[#111]/95 border border-[#333] rounded-lg p-3 text-xs space-y-3">
              {/* Exact pin-align */}
              <div>
                <p className="text-gray-300 font-semibold mb-1">📍 Pin-align (exact)</p>
                <p className="text-gray-500 leading-snug mb-2">
                  Pin two monuments to their real spots for pixel-perfect alignment.
                </p>
                <button
                  onClick={() => { setPinError(""); setPinPhase("pickA"); }}
                  disabled={monuments.length < 2}
                  className="w-full text-[11px] px-2 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white"
                >
                  {monuments.length < 2 ? "Waiting for monuments…" : "Start pin-align"}
                </button>
                {pinError && <p className="text-red-400 mt-1">{pinError}</p>}
              </div>

              <div className="border-t border-[#2a2a2a] pt-2">
                <p className="text-gray-500 leading-snug mb-2">Or fine-tune manually:</p>
                <CalSlider label="Margin" value={margin} min={-0.1} max={0.25} step={0.002} onChange={(v) => tuneCalib({ margin: v })} format={(v) => v.toFixed(3)} />
                <CalSlider label="Offset X" value={offX} min={-600} max={600} step={5} onChange={(v) => tuneCalib({ offX: v })} format={(v) => v.toFixed(0)} />
                <CalSlider label="Offset Z" value={offZ} min={-600} max={600} step={5} onChange={(v) => tuneCalib({ offZ: v })} format={(v) => v.toFixed(0)} />
                <div className="flex items-center justify-between pt-1">
                  <code className="text-[10px] text-emerald-400">
                    {`m=${margin.toFixed(3)} x=${offX.toFixed(0)} z=${offZ.toFixed(0)}`}
                  </code>
                  <button
                    onClick={resetCalib}
                    className="text-[10px] text-gray-400 hover:text-white underline"
                  >
                    reset
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Pin-align flow overlay */}
          {pinPhase !== "off" && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1100] w-80 bg-[#111]/97 border border-emerald-600 rounded-lg p-3 text-xs shadow-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-emerald-400 font-semibold">Pin-align</span>
                <button onClick={cancelPin} className="text-gray-400 hover:text-white">✕</button>
              </div>

              {(pinPhase === "pickA" || pinPhase === "pickB") && (
                <>
                  <p className="text-gray-300 mb-2">
                    {pinPhase === "pickA"
                      ? "Step 1/2 — choose a monument you can spot on the map:"
                      : "Step 2/2 — choose a second monument, far from the first:"}
                  </p>
                  <div className="max-h-56 overflow-y-auto flex flex-col gap-0.5">
                    {monuments
                      .filter((mn) => pinPhase === "pickA" || mn.name !== pinMonA?.name)
                      .map((mn, i) => (
                        <button
                          key={`${mn.name}-${i}`}
                          onClick={() => {
                            if (pinPhase === "pickA") { setPinMonA(mn); setPinPhase("clickA"); }
                            else { setPinMonB(mn); setPinPhase("clickB"); }
                          }}
                          className="text-left px-2 py-1 rounded hover:bg-[#222] text-gray-300"
                        >
                          {mn.name}
                        </button>
                      ))}
                  </div>
                </>
              )}

              {(pinPhase === "clickA" || pinPhase === "clickB") && (
                <p className="text-gray-300">
                  Now click the <span className="text-emerald-400 font-semibold">exact center</span> of{" "}
                  <span className="text-white font-semibold">
                    {pinPhase === "clickA" ? pinMonA?.name : pinMonB?.name}
                  </span>{" "}
                  on the map.
                </p>
              )}
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
