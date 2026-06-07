"use client";

import { Activity, ChevronDown, Crosshair, Flame, MapPinned, Settings, Shield, ShoppingCart, Skull, Users, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import KillFeed from "@/components/KillFeed";
import NavBar from "@/components/NavBar";
import type { DeathMarker } from "@/components/LiveMap";
import { StatusPill } from "@/components/DashboardUi";
import type { ActiveEvent, GameState, Monument } from "@/lib/gameState";
import { gridFromXZ } from "@/lib/format";
import { usePolling } from "@/lib/usePolling";

const LiveMap = dynamic(() => import("@/components/LiveMap"), { ssr: false });
const POLL_INTERVAL = 15000;

const EVENT_COLORS: Record<string, string> = {
  heli: "border-red-500/50 text-red-300",
  bradley: "border-orange-500/50 text-orange-300",
  cargo: "border-blue-400/50 text-blue-300",
  chinook: "border-yellow-400/50 text-yellow-300",
  boss: "border-red-600 bg-red-950/40 text-red-200",
};

type Pin = { lat: number; lng: number };
type PinPhase = "off" | "pickA" | "clickA" | "pickB" | "clickB";

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
  const [heat, setHeat] = useState<{ x: number; z: number; w?: number }[]>([]);
  const [heatMode, setHeatMode] = useState<"off" | "deaths" | "activity">("off");
  const [shops, setShops] = useState<{ x: number; z: number; name: string }[]>([]);
  const [showShops, setShowShops] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showPlayers, setShowPlayers] = useState(true);
  const [showKills, setShowKills] = useState(false);
  const [nowSec, setNowSec] = useState(0);
  const [focusTarget, setFocusTarget] = useState<{ x: number; z: number; key: string } | null>(null);

  const mapSize = (state.wipe?.map_size as number) ?? state.server?.mapSize ?? 3500;
  const [margin, setMargin] = useState(() => defaultMargin(3500));
  const [offX, setOffX] = useState(0);
  const [offZ, setOffZ] = useState(10);
  const [calibTouched, setCalibTouched] = useState(false);

  const [pinPhase, setPinPhase] = useState<PinPhase>("off");
  const [pinMonA, setPinMonA] = useState<Monument | null>(null);
  const [pinMonB, setPinMonB] = useState<Monument | null>(null);
  const [pinA, setPinA] = useState<Pin | null>(null);
  const [pinError, setPinError] = useState("");
  const calibrating = pinPhase === "clickA" || pinPhase === "clickB";

  useEffect(() => {
    if (calibTouched) return;
    const id = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(`mapCalib:${mapSize}`);
        if (raw) {
          const c = JSON.parse(raw);
          setMargin(c.margin ?? defaultMargin(mapSize));
          setOffX(c.offX ?? 0);
          setOffZ(c.offZ ?? 10);
          return;
        }
      } catch {
        // Fall through to defaults.
      }
      setMargin(defaultMargin(mapSize));
      setOffX(0);
      setOffZ(10);
    }, 0);
    return () => window.clearTimeout(id);
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
      } catch {
        // Local storage can be unavailable in private contexts.
      }
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
    } catch {
      // Ignore storage errors.
    }
  }, [mapSize]);

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
        const dx = pinMonB.x - pinMonA.x;
        const dz = pinMonB.z - pinMonA.z;
        if (Math.abs(dx) < 150 || Math.abs(dz) < 150) {
          setPinError("Pick two monuments far apart in both directions.");
          cancelPin();
          return;
        }
        const sx = (lng - pinA.lng) / dx;
        const sz = (lat - pinA.lat) / dz;
        const scale = (sx + sz) / 2;
        if (!(scale > 0)) {
          setPinError("Calibration failed. Click the exact monument centers and try again.");
          cancelPin();
          return;
        }
        const half = mapSize / 2;
        const nextMargin = (1 - scale * mapSize) / 2;
        const nextOffX = (pinA.lng - nextMargin) / scale - pinMonA.x - half;
        const nextOffZ = (pinA.lat - nextMargin) / scale - pinMonA.z - half;
        setCalibTouched(true);
        setMargin(nextMargin);
        setOffX(nextOffX);
        setOffZ(nextOffZ);
        try {
          localStorage.setItem(`mapCalib:${mapSize}`, JSON.stringify({ margin: nextMargin, offX: nextOffX, offZ: nextOffZ }));
        } catch {
          // Ignore storage errors.
        }
        setPinError("");
        cancelPin();
      }
    },
    [pinPhase, pinMonA, pinMonB, pinA, mapSize, cancelPin]
  );

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/gamestate");
      if (res.ok) setState(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDeaths = useCallback(async () => {
    try {
      const res = await fetch("/api/kills?since=900&limit=150");
      if (res.ok) {
        const data = await res.json();
        setDeaths(data.kills ?? []);
      }
    } catch {
      // Keep previous markers visible through transient failures.
    }
  }, []);

  const fetchHeat = useCallback(async () => {
    if (heatMode === "off") return;
    try {
      const res = await fetch(`/api/heatmap?type=${heatMode}&wipe=current&limit=5000`);
      if (res.ok) {
        const data = await res.json();
        setHeat(data.points ?? []);
      }
    } catch {
      // Keep previous heat visible through transient failures.
    }
  }, [heatMode]);

  const fetchShops = useCallback(async () => {
    if (!showShops) return;
    try {
      const res = await fetch("/api/shops");
      if (res.ok) {
        const data = await res.json();
        setShops(data.shops ?? []);
      }
    } catch {
      // Keep previous shops visible through transient failures.
    }
  }, [showShops]);

  const tickClock = useCallback(() => {
    setNowSec(Math.floor(Date.now() / 1000));
  }, []);

  usePolling(fetchState, POLL_INTERVAL);
  usePolling(fetchDeaths, showDeaths ? 60000 : 0);
  usePolling(fetchHeat, heatMode !== "off" ? 60000 : 0);
  usePolling(fetchShops, showShops ? 60000 : 0);
  usePolling(tickClock, 1000);

  const rawMapUrl = state.server?.mapUrl ?? "";
  const externalUrl = rawMapUrl && !rawMapUrl.startsWith("http://localhost") ? rawMapUrl : "";
  const mapUrl = externalUrl || `/api/map${state.server?.wipeDate ? `?v=${state.server.wipeDate}` : ""}`;
  const onlinePlayers = Object.values(state.players).filter((p) => p.online);
  const server = state.server;
  const bossEvent = state.events.find((e) => e.type === "boss");
  const monuments = state.server?.monuments ?? [];
  const isLive = !!server && nowSec > 0 && nowSec - (server.updatedAt ?? 0) < 30;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0f0f0f] text-white">
      <NavBar />
      <header className="shrink-0 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <StatusPill live={isLive} label={isLive ? "Live Map" : "Map Offline"} />
            <span className="truncate text-sm font-semibold text-white">{server?.name ?? "Waiting for server data"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
            <span><span className="font-semibold text-white">{onlinePlayers.length}</span> online{server?.maxPlayers ? ` / ${server.maxPlayers}` : ""}</span>
            {server?.wipeDate && <span>Wiped <span className="text-white">{formatAge(server.wipeDate)}</span> ago</span>}
            <span className="text-zinc-600">{state.lastUpdate ? new Date(state.lastUpdate).toLocaleTimeString() : "-"}</span>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="max-h-[42vh] shrink-0 overflow-y-auto border-b border-zinc-800 bg-zinc-950/95 lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 border-b border-zinc-800 p-2 lg:hidden">
            <ToggleButton active={showPlayers} onClick={() => setShowPlayers((v) => !v)} icon={Users} label="Players" />
            <ToggleButton active={showKills} onClick={() => setShowKills((v) => !v)} icon={Crosshair} label="Kills" />
          </div>

          {state.events.length > 0 && (
            <SidebarSection title="Active Events" defaultOpen>
              <div className="flex flex-col gap-1.5">
                {state.events.map((event: ActiveEvent, i) => (
                  <EventRow
                    key={`${event.type}-${i}`}
                    event={event}
                    mapSize={mapSize}
                    active={focusTarget?.key === `${event.type}-${i}-${event.x}-${event.z}`}
                    onFocus={() => setFocusTarget({ x: event.x, z: event.z, key: `${event.type}-${i}-${event.x}-${event.z}` })}
                  />
                ))}
              </div>
            </SidebarSection>
          )}

          <div className={`${showPlayers ? "block" : "hidden"} lg:block`}>
            <SidebarSection title={`Players (${onlinePlayers.length})`} defaultOpen>
              <div className="flex flex-col gap-1">
                {onlinePlayers.map((player) => (
                  <div key={player.steamId} className="flex items-center gap-2 rounded-md border border-zinc-900 bg-black/20 px-2 py-1.5 text-xs">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: player.teamId ? teamColor(player.teamId) : "#4ade80" }}
                    />
                    <Link href={`/player/${player.steamId}`} className="min-w-0 flex-1 truncate font-semibold text-zinc-300 hover:text-white">
                      {player.name}
                    </Link>
                    <span className="text-zinc-500">{player.health}hp</span>
                  </div>
                ))}
                {onlinePlayers.length === 0 && <p className="text-xs text-zinc-500">No players online.</p>}
              </div>
            </SidebarSection>
          </div>

          <div className={`${showKills ? "block" : "hidden"} lg:block`}>
            <SidebarSection title="Recent Kills" defaultOpen>
              <KillFeed limit={12} scope="current" />
            </SidebarSection>
          </div>
        </aside>

        <main className="relative min-h-0 flex-1">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0f0f0f]">
              <div className="text-sm font-semibold text-zinc-400">Loading map...</div>
            </div>
          )}

          {bossEvent && (
            <div className="absolute left-1/2 top-3 z-[1000] flex max-w-[92%] -translate-x-1/2 items-center gap-2 rounded-full border border-red-500/70 bg-red-950/90 px-4 py-2 text-xs font-bold text-white shadow-xl">
              <Skull className="h-4 w-4 text-red-300" aria-hidden="true" />
              <span className="truncate">{bossEvent.label}</span>
              <span className="text-red-200">{gridFromXZ(bossEvent.x, bossEvent.z, mapSize)}</span>
              {bossEvent.health !== undefined && <span className="hidden text-red-200 sm:inline">{bossEvent.health} HP</span>}
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
            shops={showShops ? shops : []}
            heat={heatMode !== "off" ? heat : []}
            calibrating={calibrating}
            onCalibrate={onCalibrate}
            focusTarget={focusTarget}
          />

          <div className="absolute right-3 top-3 z-[1000] flex gap-2">
            <button
              onClick={() => setShowDeaths((v) => !v)}
              className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold ${
                showDeaths ? "border-red-600 bg-red-600 text-white" : "border-zinc-700 bg-black/75 text-zinc-300 hover:text-white"
              }`}
              title="Toggle recent death markers from the last 15 minutes"
            >
              <Skull className="h-3.5 w-3.5" aria-hidden="true" />
              Deaths
            </button>
            <button
              onClick={() => { setHeat([]); setHeatMode((m) => (m === "deaths" ? "off" : "deaths")); }}
              className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold ${
                heatMode === "deaths" ? "border-orange-500 bg-orange-500 text-white" : "border-zinc-700 bg-black/75 text-zinc-300 hover:text-white"
              }`}
              title="Death heatmap for this wipe"
            >
              <Flame className="h-3.5 w-3.5" aria-hidden="true" />
              Deaths Heat
            </button>
            <button
              onClick={() => { setHeat([]); setHeatMode((m) => (m === "activity" ? "off" : "activity")); }}
              className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold ${
                heatMode === "activity" ? "border-cyan-500 bg-cyan-500 text-white" : "border-zinc-700 bg-black/75 text-zinc-300 hover:text-white"
              }`}
              title="Where players spend time (this wipe)"
            >
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
              Activity
            </button>
            <button
              onClick={() => setShowShops((v) => !v)}
              className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold ${
                showShops ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-700 bg-black/75 text-zinc-300 hover:text-white"
              }`}
              title="Show player vending shops"
            >
              <ShoppingCart className="h-3.5 w-3.5" aria-hidden="true" />
              Shops
            </button>
            <button
              onClick={() => setShowTools((v) => !v)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 bg-black/75 px-3 text-xs font-semibold text-zinc-300 hover:text-white"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              Tools
            </button>
          </div>

          {showTools && (
            <MapTools
              margin={margin}
              offX={offX}
              offZ={offZ}
              monuments={monuments}
              pinError={pinError}
              onClose={() => setShowTools(false)}
              onStartPin={() => { setPinError(""); setPinPhase("pickA"); }}
              tuneCalib={tuneCalib}
              resetCalib={resetCalib}
            />
          )}

          {pinPhase !== "off" && (
            <PinAlignOverlay
              phase={pinPhase}
              monuments={monuments}
              pinMonA={pinMonA}
              onCancel={cancelPin}
              onPick={(monument) => {
                if (pinPhase === "pickA") {
                  setPinMonA(monument);
                  setPinPhase("clickA");
                } else {
                  setPinMonB(monument);
                  setPinPhase("clickB");
                }
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <section className="border-b border-zinc-800 p-3 last:border-b-0">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}

function ToggleButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: LucideIcon; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-semibold ${
        active ? "border-red-600 bg-red-600 text-white" : "border-zinc-800 bg-black/30 text-zinc-400"
      }`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${active ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
  );
}

function EventRow({
  event,
  mapSize,
  active,
  onFocus,
}: {
  event: ActiveEvent;
  mapSize: number;
  active: boolean;
  onFocus: () => void;
}) {
  const Icon = event.type === "boss" ? Skull : event.type === "bradley" ? Shield : Activity;
  return (
    <button
      onClick={onFocus}
      className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-900/80 ${
        active ? "bg-zinc-900 ring-1 ring-red-500/60" : "bg-black/25"
      } ${EVENT_COLORS[event.type] ?? "border-zinc-700 text-zinc-400"}`}
      title="Center map on this event"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-semibold">{event.label}</span>
      <span className="text-zinc-500">{gridFromXZ(event.x, event.z, mapSize)}</span>
      {event.health !== undefined && <span className="text-zinc-500">{event.health} HP</span>}
    </button>
  );
}

function MapTools({
  margin,
  offX,
  offZ,
  monuments,
  pinError,
  onClose,
  onStartPin,
  tuneCalib,
  resetCalib,
}: {
  margin: number;
  offX: number;
  offZ: number;
  monuments: Monument[];
  pinError: string;
  onClose: () => void;
  onStartPin: () => void;
  tuneCalib: (next: { margin?: number; offX?: number; offZ?: number }) => void;
  resetCalib: () => void;
}) {
  return (
    <div className="absolute right-3 top-14 z-[1000] w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-zinc-700 bg-zinc-950/95 p-4 text-xs shadow-2xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-bold text-white">
          <MapPinned className="h-4 w-4 text-red-400" aria-hidden="true" />
          Map Tools
        </div>
        <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-white">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-3">
        <div className="rounded-md border border-zinc-800 bg-black/25 p-3">
          <p className="mb-1 font-semibold text-zinc-200">Pin-align</p>
          <p className="mb-2 leading-5 text-zinc-500">Pin two visible monuments to tune marker alignment.</p>
          <button
            onClick={onStartPin}
            disabled={monuments.length < 2}
            className="h-8 w-full rounded-md bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {monuments.length < 2 ? "Waiting for monuments" : "Start pin-align"}
          </button>
          {pinError && <p className="mt-2 text-red-300">{pinError}</p>}
        </div>

        <div className="space-y-2">
          <CalSlider label="Margin" value={margin} min={-0.1} max={0.25} step={0.002} onChange={(v) => tuneCalib({ margin: v })} format={(v) => v.toFixed(3)} />
          <CalSlider label="Offset X" value={offX} min={-600} max={600} step={5} onChange={(v) => tuneCalib({ offX: v })} format={(v) => v.toFixed(0)} />
          <CalSlider label="Offset Z" value={offZ} min={-600} max={600} step={5} onChange={(v) => tuneCalib({ offZ: v })} format={(v) => v.toFixed(0)} />
          <div className="flex items-center justify-between pt-1">
            <code className="text-[10px] text-emerald-300">
              {`m=${margin.toFixed(3)} x=${offX.toFixed(0)} z=${offZ.toFixed(0)}`}
            </code>
            <button onClick={resetCalib} className="text-[10px] font-semibold text-zinc-400 hover:text-white">
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PinAlignOverlay({
  phase,
  monuments,
  pinMonA,
  onCancel,
  onPick,
}: {
  phase: PinPhase;
  monuments: Monument[];
  pinMonA: Monument | null;
  onCancel: () => void;
  onPick: (monument: Monument) => void;
}) {
  const picking = phase === "pickA" || phase === "pickB";
  return (
    <div className="absolute left-1/2 top-16 z-[1100] w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-lg border border-emerald-600 bg-zinc-950/97 p-4 text-xs shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-bold text-emerald-300">Pin-align</span>
        <button onClick={onCancel} className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-white">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {picking ? (
        <>
          <p className="mb-2 text-zinc-300">
            {phase === "pickA" ? "Step 1 of 2: choose a monument you can spot on the map." : "Step 2 of 2: choose a second monument far from the first."}
          </p>
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {monuments
              .filter((monument) => phase === "pickA" || monument.name !== pinMonA?.name)
              .map((monument, i) => (
                <button
                  key={`${monument.name}-${i}`}
                  onClick={() => onPick(monument)}
                  className="rounded px-2 py-1.5 text-left text-zinc-300 hover:bg-zinc-900 hover:text-white"
                >
                  {monument.name}
                </button>
              ))}
          </div>
        </>
      ) : (
        <p className="text-zinc-300">
          Click the exact center of <span className="font-bold text-emerald-300">{phase === "clickA" ? pinMonA?.name : "the selected monument"}</span> on the map.
        </p>
      )}
    </div>
  );
}

function CalSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
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
      <span className="mb-1 flex justify-between text-zinc-300">
        <span>{label}</span>
        <span className="text-zinc-500">{format(value)}</span>
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

function defaultMargin(mapSize: number): number {
  return 500 / (mapSize + 1000);
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
    "#f87171",
    "#fb923c",
    "#facc15",
    "#a3e635",
    "#34d399",
    "#22d3ee",
    "#818cf8",
    "#e879f9",
  ];
  return colors[teamId % colors.length];
}
