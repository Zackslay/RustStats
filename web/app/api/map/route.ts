import { NextResponse } from "next/server";
import { getGameState } from "@/lib/gameState";

export const dynamic = "force-dynamic";

let cachedBlob: Blob | null = null;
let cachedAt = 0;
const CACHE_TTL = 3600 * 1000;

export async function GET() {
  if (cachedBlob && Date.now() - cachedAt < CACHE_TTL) {
    return new NextResponse(cachedBlob, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  const state = await getGameState();
  const mapUrl = state.server?.mapUrl;

  if (!mapUrl) {
    return new NextResponse("No map URL available yet", { status: 404 });
  }

  try {
    const res = await fetch(mapUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      return new NextResponse(`Upstream returned ${res.status}`, { status: 502 });
    }

    const blob = await res.blob();
    cachedBlob = blob;
    cachedAt = Date.now();

    return new NextResponse(blob, {
      headers: {
        "Content-Type": blob.type || "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new NextResponse(`Failed to fetch map: ${msg}`, { status: 502 });
  }
}
