import { NextResponse } from "next/server";
import { getShops } from "@/lib/gameState";

export const dynamic = "force-dynamic";

export async function GET() {
  const shops = await getShops();
  const res = NextResponse.json({ shops });
  res.headers.set("CDN-Cache-Control", "public, s-maxage=20, stale-while-revalidate=120");
  return res;
}
