"use client";

import { useEffect, useRef, useState } from "react";
import type { GameState } from "@/lib/gameState";

// Leaflet is browser-only — import lazily
let L: typeof import("leaflet") | null = null;

interface Props {
  mapSize: number; // Rust world size, e.g. 3500
  mapImageUrl: string; // Full map image URL
  state: GameState;
}

const EVENT_ICONS: Record<string, string> = {
  heli: "🚁",
  bradley: "🛡️",
  cargo: "🚢",
  chinook: "🚁",
};

export default function LiveMap({ mapSize, mapImageUrl, state }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const overlayRef = useRef<import("leaflet").ImageOverlay | null>(null);
  const markersRef = useRef<Map<string, import("leaflet").Marker>>(new Map());
  const eventMarkersRef = useRef<import("leaflet").Marker[]>([]);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  const BOUNDS: import("leaflet").LatLngBoundsExpression = [[0, 0], [1, 1]];

  // Rust coords → Leaflet LatLng
  // Rust: origin (0,0) = centre, +X = East, +Z = North (but Leaflet uses lat/lng)
  function rustToLatLng(x: number, z: number): [number, number] {
    const half = mapSize / 2;
    const lat = (z + half) / mapSize; // 0..1, north is higher
    const lng = (x + half) / mapSize; // 0..1
    return [lat, lng];
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
      minZoom: -2,
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
  }, [state.players]);

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
  }, [state.events]);

  return <div ref={containerRef} className="w-full h-full rounded-lg" />;
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
