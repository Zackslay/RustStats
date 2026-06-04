"use client";

import { useEffect, useRef, useState } from "react";
import type { GameState } from "@/lib/gameState";

// Leaflet is browser-only — import lazily
let L: typeof import("leaflet") | null = null;

interface Props {
  mapSize: number; // Rust world size, e.g. 3500
  mapImageUrl: string; // Full map image URL
  state: GameState;
  // Calibration: how the world maps onto the rendermap image.
  margin?: number; // ocean-margin fraction (world is inset by this on each edge)
  offX?: number; // world-unit X offset
  offZ?: number; // world-unit Z offset
  deaths?: DeathMarker[]; // recent kill locations
}

export interface DeathMarker {
  id: number;
  x: number | null;
  z: number | null;
  victim_name: string | null;
  killer_name: string | null;
}

const EVENT_ICONS: Record<string, string> = {
  heli: "🚁",
  bradley: "🛡️",
  cargo: "🚢",
  chinook: "🚁",
};

// CRS.Simple treats coordinates as CSS pixels at zoom 0.
// Bounds of [[0,0],[1,1]] = 1×1 pixel — way too small for fitBounds.
// Scale to [0,MAP_UNITS] so Leaflet can find a reasonable initial zoom.
const MAP_UNITS = 1000;
const BOUNDS: [[number, number], [number, number]] = [[0, 0], [MAP_UNITS, MAP_UNITS]];

export default function LiveMap({ mapSize, mapImageUrl, state, margin = 0, offX = 0, offZ = 0, deaths = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const overlayRef = useRef<import("leaflet").ImageOverlay | null>(null);
  const markersRef = useRef<Map<string, import("leaflet").Marker>>(new Map());
  const eventMarkersRef = useRef<import("leaflet").Marker[]>([]);
  const monumentMarkersRef = useRef<import("leaflet").Marker[]>([]);
  const deathMarkersRef = useRef<import("leaflet").Marker[]>([]);
  const gridLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  // Rust coords → Leaflet LatLng scaled to MAP_UNITS.
  // Applies calibration: world fills the [margin, 1-margin] band of the image
  // (ocean margin), plus optional world-unit offsets.
  function rustToLatLng(x: number, z: number): [number, number] {
    const half = mapSize / 2;
    let nx = ((x + offX) + half) / mapSize; // 0..1 across world
    let nz = ((z + offZ) + half) / mapSize;
    nx = margin + nx * (1 - 2 * margin);
    nz = margin + nz * (1 - 2 * margin);
    return [nz * MAP_UNITS, nx * MAP_UNITS];
  }

  // Load Leaflet once
  useEffect(() => {
    import("leaflet").then((leaflet) => {
      import("leaflet/dist/leaflet.css");
      L = leaflet.default ?? leaflet;
      setLeafletLoaded(true);
    });
  }, []);

  // Init map once Leaflet is ready (runs once only)
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

  // Update image overlay whenever mapImageUrl changes (including after first fetch)
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

  // Update player markers on state change
  useEffect(() => {
    if (!mapRef.current || !L) return;
    const map = mapRef.current;

    const seen = new Set<string>();

    for (const [steamId, p] of Object.entries(state.players)) {
      if (!p.online) continue;
      seen.add(steamId);

      const pos = rustToLatLng(p.x, p.z);

      if (markersRef.current.has(steamId)) {
        markersRef.current.get(steamId)!.setLatLng(pos);
      } else {
        const icon = L!.divIcon({
          className: "",
          html: `<div class="player-marker" style="background:${
            p.teamId ? teamColor(p.teamId) : "#4ade80"
          }">
            <span class="player-label">${p.name}</span>
          </div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        });
        const marker = L!.marker(pos, { icon }).addTo(map);
        marker.bindPopup(
          `<b>${p.name}</b><br/>HP: ${p.health}<br/>Pos: ${p.x.toFixed(0)}, ${p.z.toFixed(0)}`
        );
        markersRef.current.set(steamId, marker);
      }
    }

    // Remove disconnected players
    for (const [id, marker] of markersRef.current.entries()) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [state.players, margin, offX, offZ]);

  // Update event markers
  useEffect(() => {
    if (!mapRef.current || !L) return;
    const map = mapRef.current;

    // Clear old event markers
    for (const m of eventMarkersRef.current) m.remove();
    eventMarkersRef.current = [];

    for (const ev of state.events) {
      const pos = rustToLatLng(ev.x, ev.z);
      const icon = L!.divIcon({
        className: "",
        html: `<div class="event-marker event-${ev.type}">
          <span class="event-emoji">${EVENT_ICONS[ev.type] ?? "❓"}</span>
          <span class="event-label">${ev.label}</span>
        </div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      const m = L!.marker(pos, { icon }).addTo(map);
      if (ev.health !== undefined) {
        m.bindPopup(`<b>${ev.label}</b><br/>HP: ${ev.health}`);
      }
      eventMarkersRef.current.push(m);
    }
  }, [state.events, margin, offX, offZ]);

  // Draw the Rust coordinate grid (same transform as players, so it doubles as
  // an alignment check against the rendered map underneath).
  useEffect(() => {
    if (!mapRef.current || !L || !mapSize) return;
    const map = mapRef.current;

    if (gridLayerRef.current) {
      gridLayerRef.current.remove();
      gridLayerRef.current = null;
    }

    const group = L!.layerGroup();
    const cell = 146.86; // Rust grid cell size (meters)
    const half = mapSize / 2;
    const n = Math.floor(mapSize / cell); // cells per axis
    const lineStyle = { color: "#ffffff", weight: 1, opacity: 0.12, interactive: false };

    for (let i = 0; i <= n; i++) {
      const x = -half + i * cell;
      L!.polyline([rustToLatLng(x, -half), rustToLatLng(x, half)], lineStyle).addTo(group);
      const z = half - i * cell; // top (north) → bottom (south)
      L!.polyline([rustToLatLng(-half, z), rustToLatLng(half, z)], lineStyle).addTo(group);
    }

    // Column letters along the top, row numbers down the left.
    for (let i = 0; i < n; i++) {
      const colPos = rustToLatLng(-half + (i + 0.5) * cell, half - cell * 0.35);
      L!.marker(colPos, {
        interactive: false,
        keyboard: false,
        icon: L!.divIcon({ className: "", html: `<span class="grid-label">${colLabel(i)}</span>`, iconSize: [0, 0] }),
      }).addTo(group);

      const rowPos = rustToLatLng(-half + cell * 0.3, half - (i + 0.5) * cell);
      L!.marker(rowPos, {
        interactive: false,
        keyboard: false,
        icon: L!.divIcon({ className: "", html: `<span class="grid-label">${i}</span>`, iconSize: [0, 0] }),
      }).addTo(group);
    }

    group.addTo(map);
    gridLayerRef.current = group;
  }, [mapSize, leafletLoaded, margin, offX, offZ]);

  // Draw monument labels (static — sent by the plugin once loaded).
  useEffect(() => {
    if (!mapRef.current || !L) return;
    const map = mapRef.current;

    for (const m of monumentMarkersRef.current) m.remove();
    monumentMarkersRef.current = [];

    const monuments = state.server?.monuments ?? [];
    for (const mon of monuments) {
      const pos = rustToLatLng(mon.x, mon.z);
      const icon = L!.divIcon({
        className: "",
        html: `<div class="monument-marker"><span class="monument-dot"></span><span class="monument-label">${escapeHtml(mon.name)}</span></div>`,
        iconSize: [0, 0],
        iconAnchor: [3, 3],
      });
      const marker = L!.marker(pos, { icon, interactive: false, keyboard: false }).addTo(map);
      monumentMarkersRef.current.push(marker);
    }
    // Monuments are static; redraw only when they first arrive or calibration changes.
  }, [state.server?.monuments?.length, mapSize, leafletLoaded, margin, offX, offZ]);

  // Draw recent death markers (skulls) at kill locations.
  useEffect(() => {
    if (!mapRef.current || !L) return;
    const map = mapRef.current;

    for (const m of deathMarkersRef.current) m.remove();
    deathMarkersRef.current = [];

    for (const d of deaths) {
      if (d.x == null || d.z == null) continue;
      const pos = rustToLatLng(d.x, d.z);
      const icon = L!.divIcon({
        className: "",
        html: `<div class="death-marker">💀</div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const marker = L!.marker(pos, { icon, interactive: true, keyboard: false }).addTo(map);
      if (d.victim_name) {
        marker.bindPopup(
          `<b>${escapeHtml(d.victim_name)}</b> killed${d.killer_name ? ` by <b>${escapeHtml(d.killer_name)}</b>` : ""}`
        );
      }
      deathMarkersRef.current.push(marker);
    }
  }, [deaths, mapSize, leafletLoaded, margin, offX, offZ]);

  return <div ref={containerRef} className="w-full h-full rounded-lg" />;
}

// 0 → A, 25 → Z, 26 → AA … (Rust column labels)
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

// Simple deterministic color per team id
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
