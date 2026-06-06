import type { NextRequest } from "next/server";

const DEFAULT_SECRET = "changeme";

export function verifyPluginSecret(req: NextRequest): { ok: true } | { ok: false; status: number; error: string } {
  const configured = process.env.PLUGIN_SECRET;
  const usingDefault = !configured || configured === DEFAULT_SECRET;

  if (usingDefault && process.env.NODE_ENV === "production") {
    return {
      ok: false,
      status: 500,
      error: "PLUGIN_SECRET must be configured to a non-default value in production.",
    };
  }

  if (usingDefault) {
    console.warn("[plugin-auth] PLUGIN_SECRET is missing or default; only use this in local development.");
  }

  const expected = configured || DEFAULT_SECRET;
  if (req.headers.get("x-plugin-secret") !== expected) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}
