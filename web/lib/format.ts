// Shared display formatting helpers.

export function relativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Rust grid label from world coords (matches in-game): count=floor(size/(1024/7)),
// cell=size/count, column letters + 0-indexed row from the north edge.
export function gridFromXZ(x: number, z: number, mapSize: number): string {
  const n = Math.max(1, Math.floor(mapSize / (1024 / 7)));
  const cell = mapSize / n;
  const half = mapSize / 2;
  const col = Math.min(n - 1, Math.max(0, Math.floor((x + half) / cell)));
  const row = Math.min(n - 1, Math.max(0, Math.floor((half - z) / cell)));
  let s = "";
  let c = col + 1;
  while (c > 0) { s = String.fromCharCode(65 + ((c - 1) % 26)) + s; c = Math.floor((c - 1) / 26); }
  return s + row;
}

// Compact large numbers: 1234 -> 1.2k, 3400000 -> 3.4M
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export function formatPlaytime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

const WEAPON_NAMES: Record<string, string> = {
  "ak47.entity": "AK-47",
  "rifle.ak": "AK-47",
  "lr300.entity": "LR-300",
  "rifle.lr300": "LR-300",
  "bolt_rifle.entity": "Bolt Action",
  "rifle.bolt": "Bolt Action",
  "semi_auto_rifle.entity": "Semi Rifle",
  "m39.entity": "M39",
  "l96.entity": "L96",
  "spas12.entity": "Spas-12",
  "m92.entity": "M92",
  "python.entity": "Python",
  "thompson.entity": "Thompson",
  "smg.thompson": "Thompson",
  "mp5.entity": "MP5",
  "custom_smg.entity": "Custom SMG",
  "pistol_semiauto.entity": "Semi Pistol",
  "pistol.semiauto": "Semi Pistol",
  "pistol_revolver.entity": "Revolver",
  "double_shotgun.entity": "Double Barrel",
  "shotgun.pump": "Pump Shotgun",
  "shotgun_pump.entity": "Pump Shotgun",
  "shotgun.waterpipe": "Waterpipe",
  "bow.hunting": "Hunting Bow",
  "compound_bow.entity": "Compound Bow",
  "crossbow.entity": "Crossbow",
  "rocket_launcher.entity": "Rocket",
  "explosive.timed.deployed": "C4",
  "grenade.f1.deployed": "F1 Grenade",
  "grenade.beancan.deployed": "Beancan",
  "knife.bone": "Bone Knife",
  "salvaged_sword.entity": "Salvaged Sword",
  "machete.weapon": "Machete",
  "spear.wooden": "Wooden Spear",
  "rock.entity": "Rock",
};

export function prettyWeapon(shortName: string | null | undefined): string {
  if (!shortName) return "Unknown";
  if (WEAPON_NAMES[shortName]) return WEAPON_NAMES[shortName];
  // Generic cleanup: drop common suffixes, split on . / _, title-case.
  const cleaned = shortName
    .replace(/\.(entity|deployed|prefab|weapon)$/i, "")
    .replace(/[._]/g, " ")
    .trim();
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
