"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/map", label: "Live Map" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <header className="px-6 py-3 bg-[#161616] border-b border-[#2a2a2a] flex items-center justify-between sticky top-0 z-50">
      <Link href="/" className="text-red-500 font-bold text-xl tracking-tight">
        {process.env.NEXT_PUBLIC_BRAND ? (
          <span className="text-white">{process.env.NEXT_PUBLIC_BRAND}</span>
        ) : (
          <>RUST<span className="text-white">STATS</span></>
        )}
      </Link>
      <nav className="flex items-center gap-1">
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${
                active ? "bg-red-600 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
