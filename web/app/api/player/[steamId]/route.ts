import { NextRequest, NextResponse } from "next/server";
import { getPlayerProfile } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ steamId: string }> }
) {
  const { steamId } = await params;
  if (!/^\d{5,20}$/.test(steamId)) {
    return NextResponse.json({ error: "Invalid steamId" }, { status: 400 });
  }

  const profile = await getPlayerProfile(steamId);
  if (!profile.player) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  return NextResponse.json(profile);
}
