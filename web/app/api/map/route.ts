import { NextResponse } from "next/server";
import { getGameState } from "@/lib/gameState";

export const dynamic = "force-dynamic";

let cachedImage: Uint8Array | null = null;
let cachedAt = 0;
const CACHE_TTL = 3600 * 1000;

export async function GET() {
  if (cachedImage && Date.now() - cachedAt < CACHE_TTL) {
    return new NextResponse(cachedImage, {
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
    const res = await fetch(mapUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      return new NextResponse(`Server returned ${res.status}`, { status: 502 });
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    cachedImage = buf;
    cachedAt = Date.now();

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new NextResponse(`Failed to fetch map: ${msg}`, { status: 502 });
  }
}
