"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  RefreshCw,
  X,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Activity,
} from "lucide-react";

import {
  ApiError,
  cancelTask,
  listTasks,
  retryTask,
  type TaskItem,
  type TasksSnapshot,
} from "@/lib/api";

const STATUS_BADGE: Record<TaskItem["status"], string> = {
  queued: "border-slate-700 bg-slate-800/60 text-slate-300",
  running: "border-blue-700/60 bg-blue-500/10 text-blue-300",
  ok: "border-emerald-700/60 bg-emerald-500/10 text-emerald-300",
  error: "border-red-700/60 bg-red-500/10 text-red-300",
};

const STATUS_ICON: Record<TaskItem["status"], typeof Loader2> = {
  queued: Clock,
  running: Loader2,
  ok: CheckCircle2,
  error: AlertTriangle,
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

function duration(start: string | null | undefined, end?: string | null): string {
  if (!start) return "—";
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  const ms = Math.max(0, b - a);
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = s / 60;
  return `${m.toFixed(1)} min`;
}

export function TasksPanel() {
  const [snap, setSnap] = useState<TasksSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "recent">("active");
  const liveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await listTasks();
      if (liveRef.current) {
        setSnap(next);
        setErr(null);
      }
    } catch (e) {
      if (liveRef.current) setErr(e instanceof ApiError ? e.message : "failed to load tasks");
    } finally {
      if (liveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    liveRef.current = true;
    void refresh();
    const id = setInterval(refresh, 3000);
    return () => {
      liveRef.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  async function cancel(jobId: string) {
    setActing(jobId);
    try {
      await cancelTask(jobId);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "cancel failed");
    } finally {
      setActing(null);
    }
  }

  async function retry(jobId: string) {
    setActing(jobId);
    try {
      await retryTask(jobId);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "retry failed");
    } finally {
      setActing(null);
    }
  }

  const rows: TaskItem[] = useMemo(() => {
    if (!snap) return [];
    if (filter === "active") return [...snap.in_progress, ...snap.queued];
    if (filter === "recent") return snap.recent;
    return [...snap.in_progress, ...snap.queued, ...snap.recent];
  }, [snap, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
          {(["active", "recent", "all"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === k
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {k === "active" && <Activity className="h-3.5 w-3.5" />}
              {k === "recent" && <Clock className="h-3.5 w-3.5" />}
              {k === "all" && <RefreshCw className="h-3.5 w-3.5" />}
              {k}
            </button>
          ))}
        </div>
        {snap && (
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>
              <span className="font-semibold text-slate-200">{snap.counts.in_progress}</span> running
            </span>
            <span>
              <span className="font-semibold text-slate-200">{snap.counts.queued}</span> queued
            </span>
            <span>
              <span className="font-semibold text-slate-200">{snap.counts.recent}</span> recent
            </span>
          </div>
        )}
        <div className="flex-1" />
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-red-700/50 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center">
          <Activity className="mx-auto mb-3 h-8 w-8 text-slate-600" />
          <div className="text-sm text-slate-300">No tasks {filter === "active" ? "running or queued" : ""}</div>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            When you generate questions, evaluate, classify, harvest, build syllabi or render exams, each
            ARQ job appears here in real time.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Task</th>
                <th className="px-3 py-2 font-medium">Args</th>
                <th className="px-3 py-2 font-medium">Enqueued</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const I = STATUS_ICON[t.status];
                const active = t.status === "queued" || t.status === "running";
                return (
                  <tr key={`${t.id}-${t.status}`} className="border-t border-slate-800/70 align-top">
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${STATUS_BADGE[t.status]}`}
                      >
                        <I className={`h-3 w-3 ${t.status === "running" ? "animate-spin" : ""}`} />
                        {t.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-xs text-slate-200">{t.name}</div>
                      <div className="text-[10px] text-slate-600">{t.id.slice(0, 16)}…</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="max-w-[420px] truncate text-xs text-slate-400" title={t.args}>
                        {t.args || <span className="text-slate-600">—</span>}
                      </div>
                      {t.result && (
                        <div
                          className="mt-1 max-w-[420px] truncate text-[10px] text-slate-500"
                          title={t.result}
                        >
                          → {t.result}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">
                      {fmtTime(t.enqueue_time)}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">
                      {duration(t.start_time, t.finish_time)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {active ? (
                        <button
                          onClick={() => cancel(t.id)}
                          disabled={acting === t.id}
                          title="Cancel"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:border-red-700/50 hover:text-red-300 disabled:opacity-50"
                        >
                          {acting === t.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <X className="h-3 w-3" />
                          )}
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={() => retry(t.id)}
                          disabled={acting === t.id}
                          title="Re-enqueue with the same args"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:border-blue-700/50 hover:text-blue-300 disabled:opacity-50"
                        >
                          {acting === t.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCw className="h-3 w-3" />
                          )}
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
