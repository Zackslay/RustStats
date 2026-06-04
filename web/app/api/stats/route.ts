import { NextResponse } from "next/server";
import { getCurrentWipeId, getServerTotals } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const wipeId = await getCurrentWipeId();
  const totals = await getServerTotals(wipeId);
  return NextResponse.json(totals);
}
