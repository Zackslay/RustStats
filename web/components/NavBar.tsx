"use client";

import { Activity, CalendarDays, Map, Network, TrendingUp, Trophy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home", icon: Activity },
  { href: "/map", label: "Live Map", icon: Map },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/market", label: "Market", icon: TrendingUp },
  { href: "/tech", label: "Tech Tree", icon: Network },
  { href: "/wipe", label: "Wipe", icon: CalendarDays },
];

export default function NavBar() {
  const pathname = usePathname();
  const brand = process.env.NEXT_PUBLIC_BRAND || "RustStats";

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <Link href="/" className="min-w-0 text-lg font-black tracking-tight text-white">
          <span className="text-red-500">RUST</span>
          <span className="truncate">{brand === "RustStats" ? "STATS" : brand}</span>
        </Link>
        <nav className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-black/25 p-1">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors sm:px-3 ${
                  active ? "bg-red-600 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{link.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
