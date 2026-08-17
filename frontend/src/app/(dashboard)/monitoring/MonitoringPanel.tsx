"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Activity, Cpu, MessageSquare, DollarSign } from "lucide-react";
import { ResponsiveBar } from "@nivo/bar";

import { ApiError, getMonitor, type MonitorSnapshot } from "@/lib/api";

export function MonitoringPanel() {
  const [snap, setSnap] = useState<MonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSnap(await getMonitor());
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "failed to load monitor");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  if (loading && !snap) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> loading monitoring…
      </div>
    );
  }
  if (!snap) {
    return (
      <div className="rounded-2xl border border-red-700/50 bg-red-500/5 px-3 py-2 text-xs text-red-300">
        {err ?? "no data"}
      </div>
    );
  }

  const t = snap.totals;
  const line = snap.recent_24h
    .filter((p) => p.hour)
    .map((p) => ({
      hour: new Date(p.hour!).toLocaleTimeString([], { hour: "2-digit" }),
      tokens: p.tokens,
    }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
        {err && <span className="text-xs text-red-300">{err}</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={MessageSquare} label="Messages" value={t.messages} />
        <Kpi icon={Activity} label="Conversations" value={t.conversations} />
        <Kpi
          icon={Cpu}
          label="Tokens (in / out)"
          value={`${fmt(t.tokens_in)} / ${fmt(t.tokens_out)}`}
        />
        <Kpi
          icon={DollarSign}
          label="Reported cost"
          value={t.cost_usd > 0 ? `$${t.cost_usd.toFixed(4)}` : "—"}
          hint={t.cost_usd > 0 ? undefined : "Most providers don't report cost"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Per provider / model">
          {snap.by_provider.length === 0 ? (
            <Empty>No conversations recorded yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="px-2 py-1.5">Provider</th>
                    <th className="px-2 py-1.5">Model</th>
                    <th className="px-2 py-1.5 text-right">Msgs</th>
                    <th className="px-2 py-1.5 text-right">Tokens in</th>
                    <th className="px-2 py-1.5 text-right">Tokens out</th>
                    <th className="px-2 py-1.5 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.by_provider.map((r) => (
                    <tr key={`${r.provider}-${r.model}`} className="border-t border-slate-800/70">
                      <td className="px-2 py-1.5 text-slate-200">{r.provider}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-slate-400">{r.model}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{fmt(r.messages)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{fmt(r.tokens_in)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{fmt(r.tokens_out)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">
                        {r.cost_usd > 0 ? `$${r.cost_usd.toFixed(4)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="24-hour token activity">
          {line.length === 0 ? (
            <Empty>No activity in the last 24 hours.</Empty>
          ) : (
            <div className="h-72">
              <ResponsiveBar
                data={line}
                keys={["tokens"]}
                indexBy="hour"
                margin={{ top: 16, right: 16, bottom: 36, left: 56 }}
                padding={0.25}
                colors={["#60a5fa"]}
                axisLeft={{ tickSize: 0, tickPadding: 6 }}
                axisBottom={{ tickSize: 0, tickPadding: 6, tickRotation: -25 }}
                enableLabel={false}
                theme={{
                  text: { fill: "#94a3b8" },
                  grid: { line: { stroke: "#1e293b" } },
                  axis: {
                    domain: { line: { stroke: "#1e293b" } },
                    ticks: { line: { stroke: "#1e293b" }, text: { fill: "#94a3b8" } },
                  },
                }}
                animate={false}
              />
            </div>
          )}
        </Card>
      </div>

      <Card title="Configured providers">
        {snap.providers_configured.length === 0 ? (
          <Empty>None configured — add one under AI → Providers.</Empty>
        ) : (
          <div className="flex flex-wrap gap-2">
            {snap.providers_configured.map((p) => (
              <span
                key={p.name}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300"
              >
                <Cpu className="h-3 w-3 text-slate-500" />
                {p.name}
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                  {p.type}
                </span>
              </span>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Kpi({
  icon: I,
  label,
  value,
  hint,
}: {
  icon: typeof Activity;
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <I className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">
        {typeof value === "number" ? fmt(value) : value}
      </div>
      {hint && <div className="text-[10px] text-slate-600">{hint}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-3 text-sm font-semibold text-slate-200">{title}</div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/30 px-4 py-6 text-center text-xs text-slate-500">
      {children}
    </div>
  );
}

function fmt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
