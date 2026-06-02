import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-5xl font-black tracking-tight">
          RUST<span className="text-red-500">STATS</span>
        </h1>
        <p className="mt-2 text-gray-400 text-sm">
          Live server dashboard — powered by your Oxide plugin
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-md">
        <Link
          href="/map"
          className="flex flex-col items-center justify-center gap-2 bg-[#161616] border border-[#2a2a2a] rounded-xl p-8 hover:border-red-600 hover:bg-[#1a1a1a] transition-all group"
        >
          <span className="text-4xl">🗺️</span>
          <span className="font-bold text-sm tracking-wide group-hover:text-red-400 transition-colors">
            LIVE MAP
          </span>
          <span className="text-xs text-gray-500 text-center">
            Player positions, heli, bradley, cargo
          </span>
        </Link>

        <Link
          href="/leaderboard"
          className="flex flex-col items-center justify-center gap-2 bg-[#161616] border border-[#2a2a2a] rounded-xl p-8 hover:border-red-600 hover:bg-[#1a1a1a] transition-all group"
        >
          <span className="text-4xl">🏆</span>
          <span className="font-bold text-sm tracking-wide group-hover:text-red-400 transition-colors">
            LEADERBOARD
          </span>
          <span className="text-xs text-gray-500 text-center">
            Kills, gathering, explosives & more
          </span>
        </Link>
      </div>

      <p className="text-[11px] text-gray-600 text-center max-w-sm">
        Install{" "}
        <code className="text-gray-400">plugin/RustCompanion.cs</code> on your
        Oxide server, set your{" "}
        <code className="text-gray-400">PLUGIN_SECRET</code> env var, and data
        will start flowing automatically.
      </p>
    </div>
  );
}
