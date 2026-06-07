"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "@/lib/gameState";

let L: typeof import("leaflet") | null = null;

interface Props {
  mapSize: number;
  mapImageUrl: string;
  state: GameState;
  margin?: number;
  offX?: number;
  offZ?: number;
  deaths?: DeathMarker[];
  heat?: { x: number; z: number; w?: number }[];
  calibrating?: boolean;
  onCalibrate?: (latNorm: number, lngNorm: number) => void;
  focusTarget?: { x: number; z: number; key: string } | null;
}

export interface DeathMarker {
  id: number;
  x: number | null;
  z: number | null;
  victim_name: string | null;
  killer_name: string | null;
}

const EVENT_GLYPHS: Record<string, string> = {
  heli: "H",
  bradley: "B",
  cargo: "C",
  chinook: "CH",
  boss: "X",
};

const MAP_UNITS = 1000;
const BOUNDS: [[number, number], [number, number]] = [[0, 0], [MAP_UNITS, MAP_UNITS]];

export default function LiveMap({
  mapSize,
  mapImageUrl,
  state,
  margin = 0,
  offX = 0,
  offZ = 0,
  deaths = [],
  heat = [],
  calibrating = false,
  onCalibrate,
  focusTarget = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const overlayRef = useRef<import("leaflet").ImageOverlay | null>(null);
  const markersRef = useRef<Map<string, import("leaflet").Marker>>(new Map());
  const eventMarkersRef = useRef<import("leaflet").Marker[]>([]);
  const monumentMarkersRef = useRef<import("leaflet").Marker[]>([]);
  const deathMarkersRef = useRef<import("leaflet").Marker[]>([]);
  const gridLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const heatLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  const rustToLatLng = useCallback((x: number, z: number): [number, number] => {
    const half = mapSize / 2;
    let nx = ((x + offX) + half) / mapSize;
    let nz = ((z + offZ) + half) / mapSize;
    nx = margin + nx * (1 - 2 * margin);
    nz = margin + nz * (1 - 2 * margin);
    return [nz * MAP_UNITS, nx * MAP_UNITS];
  }, [mapSize, margin, offX, offZ]);

  useEffect(() => {
    import("leaflet").then((leaflet) => {
      import("leaflet/dist/leaflet.css");
      L = leaflet.default ?? leaflet;
      setLeafletLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!leafletLoaded || !L || !containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -3,
      maxZoom: 4,
      zoomSnap: 0.25,
      attributionControl: false,
    });

    map.fitBounds(BOUNDS);
    mapRef.current = map;
  }, [leafletLoaded]);

  useEffect(() => {
    if (!mapRef.current || !L || !calibrating) return;
    const map = mapRef.current;
    const handler = (e: { latlng: { lat: number; lng: number } }) =>
      onCalibrate?.(e.latlng.lat / MAP_UNITS, e.latlng.lng / MAP_UNITS);
    map.on("click", handler);
    const el = map.getContainer();
    el.style.cursor = "crosshair";
    return () => {
      map.off("click", handler);
      el.style.cursor = "";
    };
  }, [calibrating, leafletLoaded, onCalibrate]);

  useEffect(() => {
    if (!mapRef.current || !focusTarget) return;
    const map = mapRef.current;
    const zoom = Math.max(map.getZoom(), 0.5);
    map.flyTo(rustToLatLng(focusTarget.x, focusTarget.z), zoom, { duration: 0.45 });
  }, [focusTarget, rustToLatLng]);

  useEffect(() => {
    if (!mapRef.current || !L) return;

    if (overlayRef.current) {
      overlayRef.current.remove();
      overlayRef.current = null;
    }

    if (mapImageUrl) {
      overlayRef.current = L.imageOverlay(mapImageUrl, BOUNDS).addTo(mapRef.current);
      mapRef.current.fitBounds(BOUNDS);
    }
  }, [mapImageUrl, leafletLoaded]);

  useEffect(() => {
    if (!mapRef.current || !L) return;
    const map = mapRef.current;
    const seen = new Set<string>();

    for (const [steamId, player] of Object.entries(state.players)) {
      if (!player.online) continue;
      seen.add(steamId);

      const pos = rustToLatLng(player.x, player.z);
      if (markersRef.current.has(steamId)) {
        markersRef.current.get(steamId)!.setLatLng(pos);
      } else {
        const icon = L.divIcon({
          className: "",
          html: `<div class="player-marker" style="background:${player.teamId ? teamColor(player.teamId) : "#4ade80"}">
            <span class="player-label">${escapeHtml(player.name)}</span>
          </div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        });
        const marker = L.marker(pos, { icon }).addTo(map);
        marker.bindPopup(
          `<b>${escapeHtml(player.name)}</b><br/>HP: ${player.health}<br/>Pos: ${player.x.toFixed(0)}, ${player.z.toFixed(0)}`
        );
        markersRef.current.set(steamId, marker);
      }
    }

    for (const [id, marker] of markersRef.current.entries()) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [state.players, rustToLatLng]);

  useEffect(() => {
    if (!mapRef.current || !L) return;
    const map = mapRef.current;

    for (const marker of eventMarkersRef.current) marker.remove();
    eventMarkersRef.current = [];

    for (const ev of state.events) {
      const pos = rustToLatLng(ev.x, ev.z);
      const scale = Math.max(1, Math.min(2, ev.scale ?? 1)); // tier size, capped
      const sz = Math.round(42 * scale);
      const icon = L.divIcon({
        className: "",
        html: `<div class="event-marker event-${ev.type}" style="transform:scale(${scale})">
          <span class="event-glyph">${EVENT_GLYPHS[ev.type] ?? "?"}</span>
          <span class="event-label">${escapeHtml(ev.label)}</span>
        </div>`,
        iconSize: [sz, sz],
        iconAnchor: [sz / 2, sz / 2],
      });
      const marker = L.marker(pos, { icon }).addTo(map);
      if (ev.health !== undefined) {
        marker.bindPopup(`<b>${escapeHtml(ev.label)}</b><br/>HP: ${ev.health}`);
      }
      eventMarkersRef.current.push(marker);
    }
  }, [state.events, rustToLatLng]);

  useEffect(() => {
    if (!mapRef.current || !L || !mapSize) return;
    const map = mapRef.current;

    if (gridLayerRef.current) {
      gridLayerRef.current.remove();
      gridLayerRef.current = null;
    }

    const group = L.layerGroup();
    const half = mapSize / 2;
    const n = Math.max(1, Math.floor(mapSize / (1024 / 7)));
    const cell = mapSize / n;
    const lineStyle = { color: "#ffffff", weight: 1, opacity: 0.12, interactive: false };

    for (let i = 0; i <= n; i++) {
      const x = -half + i * cell;
      L.polyline([rustToLatLng(x, -half), rustToLatLng(x, half)], lineStyle).addTo(group);
      const z = half - i * cell;
      L.polyline([rustToLatLng(-half, z), rustToLatLng(half, z)], lineStyle).addTo(group);
    }

    for (let i = 0; i < n; i++) {
      const colPos = rustToLatLng(-half + (i + 0.5) * cell, half - cell * 0.35);
      L.marker(colPos, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: "", html: `<span class="grid-label">${colLabel(i)}</span>`, iconSize: [0, 0] }),
      }).addTo(group);

      const rowPos = rustToLatLng(-half + cell * 0.3, half - (i + 0.5) * cell);
      L.marker(rowPos, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: "", html: `<span class="grid-label">${i}</span>`, iconSize: [0, 0] }),
      }).addTo(group);
    }

    group.addTo(map);
    gridLayerRef.current = group;
  }, [mapSize, leafletLoaded, rustToLatLng]);

  useEffect(() => {
    if (!mapRef.current || !L) return;
    const map = mapRef.current;

    for (const marker of monumentMarkersRef.current) marker.remove();
    monumentMarkersRef.current = [];

    for (const monument of state.server?.monuments ?? []) {
      const pos = rustToLatLng(monument.x, monument.z);
      const icon = L.divIcon({
        className: "",
        html: `<div class="monument-marker"><span class="monument-dot"></span><span class="monument-label">${escapeHtml(monument.name)}</span></div>`,
        iconSize: [0, 0],
        iconAnchor: [3, 3],
      });
      const marker = L.marker(pos, { icon, interactive: false, keyboard: false }).addTo(map);
      monumentMarkersRef.current.push(marker);
    }
  }, [state.server?.monuments, leafletLoaded, rustToLatLng]);

  useEffect(() => {
    if (!mapRef.current || !L) return;
    const map = mapRef.current;

    for (const marker of deathMarkersRef.current) marker.remove();
    deathMarkersRef.current = [];

    for (const death of deaths) {
      if (death.x == null || death.z == null) continue;
      const pos = rustToLatLng(death.x, death.z);
      const icon = L.divIcon({
        className: "",
        html: `<div class="death-marker">X</div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const marker = L.marker(pos, { icon, interactive: true, keyboard: false }).addTo(map);
      if (death.victim_name) {
        marker.bindPopup(
          `<b>${escapeHtml(death.victim_name)}</b> killed${death.killer_name ? ` by <b>${escapeHtml(death.killer_name)}</b>` : ""}`
        );
      }
      deathMarkersRef.current.push(marker);
    }
  }, [deaths, leafletLoaded, rustToLatLng]);

  // Heatmap layer (binned colored cells from a list of world points)
  useEffect(() => {
    if (!mapRef.current || !L) return;
    const map = mapRef.current;
    if (heatLayerRef.current) { heatLayerRef.current.remove(); heatLayerRef.current = null; }
    if (heat.length === 0) return;

    const N = 48;
    const half = mapSize / 2;
    const cell = mapSize / N;
    const counts = new Map<string, number>();
    let max = 1;
    for (const p of heat) {
      const gx = Math.min(N - 1, Math.max(0, Math.floor((p.x + half) / cell)));
      const gz = Math.min(N - 1, Math.max(0, Math.floor((p.z + half) / cell)));
      const k = `${gx},${gz}`;
      const v = (counts.get(k) ?? 0) + (p.w ?? 1);
      counts.set(k, v);
      if (v > max) max = v;
    }

    const group = L.layerGroup();
    for (const [k, v] of counts) {
      const [gx, gz] = k.split(",").map(Number);
      const x0 = -half + gx * cell, x1 = x0 + cell;
      const z0 = -half + gz * cell, z1 = z0 + cell;
      const a = rustToLatLng(x0, z0);
      const b = rustToLatLng(x1, z1);
      const t = v / max;
      L.rectangle(
        [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])]],
        { stroke: false, fill: true, fillColor: heatColor(t), fillOpacity: 0.18 + 0.55 * t, interactive: false }
      ).addTo(group);
    }
    group.addTo(map);
    heatLayerRef.current = group;
  }, [heat, leafletLoaded, rustToLatLng, mapSize]);

  return <div ref={containerRef} className="h-full w-full rounded-lg" />;
}

// 0 -> cyan, 0.5 -> yellow, 1 -> red
function heatColor(t: number): string {
  const r = Math.round(255 * Math.min(1, t * 2));
  const g = Math.round(255 * Math.min(1, 2 - t * 2));
  const b = Math.round(255 * Math.max(0, 1 - t * 2));
  return `rgb(${r},${g},${b})`;
}

function colLabel(i: number): string {
  let s = "";
  i += 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c)
  );
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
