// Fetches Steam avatar URLs for a set of SteamIDs via the Steam Web API.
// Requires STEAM_API_KEY in the environment; returns {} (graceful fallback to
// letter avatars) if the key is missing or the request fails.

export async function fetchSteamAvatars(
  steamIds: string[]
): Promise<Record<string, string>> {
  const key = process.env.STEAM_API_KEY;
  if (!key || steamIds.length === 0) return {};

  const out: Record<string, string> = {};
  // Steam allows up to 100 ids per request.
  for (let i = 0; i < steamIds.length; i += 100) {
    const batch = steamIds.slice(i, i + 100);
    const url =
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/` +
      `?key=${key}&steamids=${batch.join(",")}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      for (const p of data?.response?.players ?? []) {
        const avatar = p.avatarfull || p.avatarmedium || p.avatar;
        if (p.steamid && avatar) out[p.steamid] = avatar;
      }
    } catch {
      // ignore — fall back to letter avatars
    }
  }
  return out;
}
