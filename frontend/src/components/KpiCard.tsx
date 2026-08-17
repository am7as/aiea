import { cn } from "@/lib/cn";

type Props = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string | number;
  caption?: string;
  accent?: "blue" | "green" | "amber" | "rose" | "violet";
};

const accentMap = {
  blue: { bg: "bg-blue-500/15", fg: "text-blue-400" },
  green: { bg: "bg-green-500/15", fg: "text-green-400" },
  amber: { bg: "bg-amber-500/15", fg: "text-amber-400" },
  rose: { bg: "bg-rose-500/15", fg: "text-rose-400" },
  violet: { bg: "bg-violet-500/15", fg: "text-violet-400" },
};

export function KpiCard({ icon: Icon, title, value, caption, accent = "blue" }: Props) {
  const a = accentMap[accent];
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex items-center gap-3">
        <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center", a.bg, a.fg)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-sm text-slate-300">{title}</div>
      </div>
      <div className="mt-5">
        <div className="text-3xl font-semibold tracking-tight text-slate-100">{value}</div>
        {caption && <div className="text-xs text-slate-500 mt-1">{caption}</div>}
      </div>
    </div>
  );
}
