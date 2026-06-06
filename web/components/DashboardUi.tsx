import type { LucideIcon } from "lucide-react";

export function PageShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-h-screen bg-[radial-gradient(circle_at_top,#211614_0,#101010_34rem,#0b0b0b_100%)] text-zinc-100 ${className}`}>
      {children}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)] ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  accent = "text-zinc-100",
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  accent?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-1 truncate text-lg font-bold ${accent}`}>{value}</div>
    </div>
  );
}

export function StatusPill({
  live,
  label,
}: {
  live: boolean;
  label: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
      live ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-zinc-700 bg-zinc-900 text-zinc-400"
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-zinc-500"}`} />
      {label}
    </span>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-4 text-sm text-zinc-500">{children}</p>;
}
