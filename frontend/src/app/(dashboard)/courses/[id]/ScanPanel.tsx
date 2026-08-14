"use client";

import { useEffect, useRef, useState } from "react";
import { FolderSearch, Play, RefreshCw, Zap } from "lucide-react";

import {
  ApiError,
  ingestMaterial,
  ingestPending,
  scanCourse,
  type ScanResult,
} from "@/lib/api";
import { cn } from "@/lib/cn";

type Status = "pending" | "running" | "done" | "error" | null;

function StatusPill({ status }: { status: Status }) {
  const map: Record<NonNullable<Status>, string> = {
    pending: "bg-slate-800/80 text-slate-300",
    running: "bg-blue-500/15 text-blue-300",
    done: "bg-green-500/15 text-green-300",
    error: "bg-rose-500/15 text-rose-300",
  };
  if (!status) return <span className="text-[11px] text-slate-500">—</span>;
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", map[status])}>
      {status}
    </span>
  );
}

export function ScanPanel({
  courseId,
  materialsPath,
}: {
  courseId: string;
  materialsPath: string | null;
}) {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const initialDone = useRef(false);

  async function runScan(autoIngest = false): Promise<void> {
    if (!materialsPath) return;
    setBusy(true);
    setError(null);
    try {
      const r = await scanCourse(courseId, autoIngest);
      setScan(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Scan failed");
    } finally {
      setBusy(false);
    }
  }

  async function ingestAllPending(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await ingestPending(courseId);
      setAutoRefresh(true);
      await runScan(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ingest failed");
    } finally {
      setBusy(false);
    }
  }

  const pendingCount =
    scan?.collections.reduce(
      (sum, c) =>
        sum +
        c.files.filter(
          (f) => f.extraction_status === "pending" || f.extraction_status === "error",
        ).length,
      0,
    ) ?? 0;

  useEffect(() => {
    if (!materialsPath || initialDone.current) return;
    initialDone.current = true;
    void runScan(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialsPath]);

  useEffect(() => {
    if (!autoRefresh || !scan) return;
    const hasActive = scan.collections.some((c) =>
      c.files.some((f) => f.extraction_status === "pending" || f.extraction_status === "running"),
    );
    if (!hasActive) return;
    const handle = window.setInterval(() => {
      void runScan(false);
    }, 2000);
    return () => window.clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, scan]);

  if (!materialsPath) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center">
        <FolderSearch className="h-8 w-8 text-slate-500 mx-auto mb-2" />
        <p className="text-slate-300">No materials path configured for this course.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Materials</h2>
          <p className="text-xs text-slate-500 font-mono mt-0.5">{materialsPath}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-400 mr-2">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-blue-500"
            />
            auto-refresh
          </label>
          <button
            type="button"
            onClick={() => runScan(false)}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
            Rescan
          </button>
          <button
            type="button"
            onClick={() => runScan(true)}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            Scan + ingest new
          </button>
          <button
            type="button"
            onClick={ingestAllPending}
            disabled={busy || pendingCount === 0}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
          >
            <Zap className="h-3.5 w-3.5" />
            Extract all pending{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300 mb-4">
          {error}
        </div>
      )}

      {scan && (
        <div className="text-xs text-slate-500 mb-4">
          {scan.total_files} files registered across {scan.collections.length} collections
          {scan.new_registered > 0 && (
            <span className="ml-2 text-blue-400">(+{scan.new_registered} new)</span>
          )}
        </div>
      )}

      {scan?.collections.map((c) => (
        <div key={c.name} className="mb-5">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
            <span>{c.name}</span>
            <span className="text-slate-600">·</span>
            <span>{c.files.length}</span>
          </div>
          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-800/70">
                {c.files.map((f) => (
                  <tr key={f.subpath} className="hover:bg-slate-900/40">
                    <td className="px-4 py-2 text-slate-100 font-mono text-xs">
                      <div>{f.filename}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{f.subpath}</div>
                    </td>
                    <td className="px-4 py-2 text-right text-slate-400 tabular-nums text-xs whitespace-nowrap">
                      {Math.round(f.size / 1024).toLocaleString()} KB
                    </td>
                    <td className="px-4 py-2 text-right text-slate-400 tabular-nums text-xs whitespace-nowrap">
                      {f.pages ?? "—"} pp
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <StatusPill status={f.extraction_status} />
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {f.material_id && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!f.material_id) return;
                            await ingestMaterial(f.material_id);
                            await runScan(false);
                          }}
                          disabled={f.extraction_status === "running"}
                          className="text-[11px] text-blue-400 hover:text-blue-300 disabled:opacity-50"
                        >
                          {f.extraction_status === "done" ? "Re-ingest" : "Ingest"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {!scan && !busy && (
        <div className="text-sm text-slate-500 italic">Click Rescan to populate.</div>
      )}
    </section>
  );
}
