"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  ChevronRight,
  Trash2,
  FileText,
  FileDown,
  FileCode,
  Hammer,
  Play,
  BookOpen,
  Sparkles,
  Download,
  Search,
  List,
  BarChart3,
  X,
} from "lucide-react";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveBar } from "@nivo/bar";
import { ResponsiveHeatMap } from "@nivo/heatmap";

import {
  ApiError,
  listExams,
  getExam,
  deleteExam,
  renderExam,
  compileExam,
  renderExamsBatch,
  compileExamsBatch,
  deleteExamsBatch,
  examFileUrl,
  examFileText,
  listExamSources,
  readExamSource,
  writeExamSource,
  resetExamTemplate,
  compareExamReproduction,
  importReferenceExams,
  listMaterials,
  listTasks,
  analyzeExam,
  reconcileExams,
  type ExamSummary,
  type ExamDetail,
  type ExamQuestionRow,
  type Material,
  type ExamAnalysis,
  type ExamSourceFile,
} from "@/lib/api";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { QuestionDetailModal } from "@/components/QuestionDetailModal";
import { examShortId } from "@/lib/shortid";

const NIVO_THEME = {
  text: { fill: "#94a3b8", fontSize: 11 },
  axis: {
    ticks: { text: { fill: "#94a3b8", fontSize: 10 } },
    legend: { text: { fill: "#cbd5e1", fontSize: 11 } },
  },
  grid: { line: { stroke: "#1e293b", strokeWidth: 1 } },
  legends: { text: { fill: "#94a3b8", fontSize: 11 } },
  tooltip: {
    container: {
      background: "#0f172a",
      color: "#e2e8f0",
      fontSize: 11,
      border: "1px solid #1e293b",
      borderRadius: 8,
    },
  },
};

const NIVO_COLORS = ["#3b82f6", "#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#f43f5e"];

const STATUS: Record<string, string> = {
  draft: "text-slate-400",
  building: "text-amber-400",
  ready: "text-emerald-400",
  rendered: "text-blue-400",
  compiled: "text-violet-400",
  error: "text-red-400",
  archived: "text-slate-500",
};

/** Validation state, shown on every row so an examiner can see at a glance which
 *  papers are safe to release without opening each one. */
const VALIDATION: Record<string, { label: string; cls: string }> = {
  clean: { label: "validated", cls: "border-emerald-700/50 bg-emerald-500/10 text-emerald-300" },
  blocked: { label: "blocked", cls: "border-red-700/50 bg-red-500/10 text-red-300" },
  overridden: { label: "overridden", cls: "border-amber-700/50 bg-amber-500/10 text-amber-300" },
};

const KIND: Record<string, { short: string; cls: string }> = {
  mcq: { short: "mcq", cls: "bg-blue-600/30 text-blue-300" },
  short: { short: "short", cls: "bg-emerald-600/30 text-emerald-300" },
  essay: { short: "essay", cls: "bg-violet-600/30 text-violet-300" },
  problem: { short: "prob", cls: "bg-amber-600/30 text-amber-300" },
  code: { short: "code", cls: "bg-rose-600/30 text-rose-300" },
  true_false: { short: "t/f", cls: "bg-sky-600/30 text-sky-300" },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function promptPreview(md: string): string {
  return md.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim();
}

type View = "list" | "analytics";

export function ExamBankPanel({
  courseId,
  courseCode,
}: {
  courseId: string;
  courseCode?: string;
}) {
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [resyncing, setResyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<"render" | "compile" | "delete" | null>(null);
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const [bulkErr, setBulkErr] = useState<string | null>(null);

  const refresh = useCallback(
    async (initial = false) => {
      if (initial) setLoading(true);
      else setResyncing(true);
      try {
        if (!initial) {
          const recon = await reconcileExams(courseId);
          const bits: string[] = [];
          if (recon.removed > 0)
            bits.push(`dropped ${recon.removed} exam(s) whose folder was missing`);
          if (recon.nulled > 0)
            bits.push(
              `cleared stale tex/pdf paths on ${recon.nulled} exam(s) — re-render to rebuild`,
            );
          if (bits.length > 0) setImportNote(`Resync: ${bits.join("; ")}.`);
        }
        setExams(await listExams(courseId));
        setErr(null);
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "failed to load exams");
      } finally {
        setLoading(false);
        setResyncing(false);
      }
    },
    [courseId],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  const handleImport = useCallback(async () => {
    setImporting(true);
    setImportNote(null);
    setErr(null);
    try {
      const { imported } = await importReferenceExams(courseId);
      setImportNote(`imported ${imported}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "import failed");
    } finally {
      setImporting(false);
    }
  }, [courseId, refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return exams;
    return exams.filter((e) => e.title.toLowerCase().includes(q));
  }, [exams, query]);

  const reference = filtered.filter((e) => e.origin === "reference");
  const generated = filtered.filter((e) => e.origin === "generated");

  function onDeleted(id: string) {
    setExams((xs) => xs.filter((x) => x.id !== id));
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function onUpdated(next: ExamSummary) {
    setExams((xs) => xs.map((x) => (x.id === next.id ? next : x)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleMany(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setBulkNote(null);
    setBulkErr(null);
  }

  const selectionActive = selected.size > 0;

  const handleBulkRender = useCallback(async () => {
    setBulkBusy("render");
    setBulkNote(null);
    setBulkErr(null);
    try {
      const ids = [...selected];
      const r = await renderExamsBatch(ids, overwrite);
      setBulkNote(`Enqueued ${r.enqueued} · skipped ${r.skipped}`);
      await refresh();
    } catch (e) {
      setBulkErr(e instanceof ApiError ? e.message : "bulk render failed");
    } finally {
      setBulkBusy(null);
    }
  }, [selected, overwrite, refresh]);

  const handleBulkCompile = useCallback(async () => {
    setBulkBusy("compile");
    setBulkNote(null);
    setBulkErr(null);
    try {
      const ids = [...selected];
      const r = await compileExamsBatch(ids, overwrite);
      setBulkNote(`Enqueued ${r.enqueued} · skipped ${r.skipped}`);
      await refresh();
    } catch (e) {
      setBulkErr(e instanceof ApiError ? e.message : "bulk compile failed");
    } finally {
      setBulkBusy(null);
    }
  }, [selected, overwrite, refresh]);

  const handleBulkDelete = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Delete ${ids.length} exam${ids.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBulkBusy("delete");
    setBulkNote(null);
    setBulkErr(null);
    try {
      const r = await deleteExamsBatch(ids);
      setBulkNote(`Deleted ${r.deleted}`);
      setSelected(new Set());
      await refresh();
    } catch (e) {
      setBulkErr(e instanceof ApiError ? e.message : "bulk delete failed");
    } finally {
      setBulkBusy(null);
    }
  }, [selected, refresh]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> loading exams…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
          <span className="font-medium text-slate-200">
            {exams.length} exam{exams.length === 1 ? "" : "s"}
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-sky-400">
            {exams.filter((e) => e.origin === "reference").length} reference
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-blue-400">
            {exams.filter((e) => e.origin === "generated").length} generated
          </span>
        </div>

        <div className="flex-1" />

        {/* view toggle */}
        <div className="flex overflow-hidden rounded-lg border border-slate-700">
          <button
            onClick={() => setView("list")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] ${
              view === "list"
                ? "bg-slate-800 text-slate-100"
                : "text-slate-400 hover:bg-slate-900/60"
            }`}
          >
            <List className="h-3.5 w-3.5" />
            List
          </button>
          <button
            onClick={() => setView("analytics")}
            className={`inline-flex items-center gap-1.5 border-l border-slate-700 px-2.5 py-1.5 text-[11px] ${
              view === "analytics"
                ? "bg-slate-800 text-slate-100"
                : "text-slate-400 hover:bg-slate-900/60"
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Analytics
          </button>
        </div>

        <button
          onClick={() => void handleImport()}
          disabled={importing}
          title="Register the course's past exams as reference Exam rows"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-300 hover:border-slate-600 disabled:opacity-50"
        >
          {importing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Import reference exams
        </button>

        <button
          onClick={() => void refresh()}
          disabled={resyncing}
          title="Resync — re-fetch the exam list"
          className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:border-slate-600 disabled:opacity-50"
        >
          {resyncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {importNote && (
        <div className="rounded-lg border border-emerald-700/50 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
          {importNote}
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-red-700/50 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}

      {view === "analytics" ? (
        <ExamAnalytics exams={exams} />
      ) : (
        <>
          {/* search */}
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder="Search exams by title…"
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 py-1.5 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-500 focus:border-slate-600 focus:outline-none"
            />
          </div>

          {selectionActive && (
            <BulkToolbar
              count={selected.size}
              overwrite={overwrite}
              setOverwrite={setOverwrite}
              busy={bulkBusy}
              onRender={handleBulkRender}
              onCompile={handleBulkCompile}
              onDelete={handleBulkDelete}
              onClear={clearSelection}
              note={bulkNote}
              err={bulkErr}
            />
          )}

          <ExamSection
            title="Reference exams"
            icon={<BookOpen className="h-4 w-4 text-sky-400" />}
            exams={reference}
            empty="No reference exams. Harvest past exams from materials to build the bank."
            courseId={courseId}
            courseCode={courseCode}
            onDeleted={onDeleted}
            onUpdated={onUpdated}
            selected={selected}
            onToggleOne={toggleOne}
            onToggleMany={toggleMany}
            selectionActive={selectionActive}
          />

          <ExamSection
            title="Generated exams"
            icon={<Sparkles className="h-4 w-4 text-blue-400" />}
            exams={generated}
            empty="No generated exams yet. Assemble one from the question bank."
            courseId={courseId}
            courseCode={courseCode}
            onDeleted={onDeleted}
            onUpdated={onUpdated}
            selected={selected}
            onToggleOne={toggleOne}
            onToggleMany={toggleMany}
            selectionActive={selectionActive}
          />
        </>
      )}
    </div>
  );
}

type DiffRow = {
  exam: string;
  D1: number;
  D2: number;
  D3: number;
  D4: number;
  D5: number;
  [key: string]: string | number;
};

type HeatRow = {
  id: string;
  data: { x: string; y: number }[];
};

function ExamAnalytics({ exams }: { exams: ExamSummary[] }) {
  const [details, setDetails] = useState<Record<string, ExamDetail>>({});
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  useEffect(() => {
    if (exams.length === 0) return;
    const missing = exams.filter((e) => !details[e.id]);
    if (missing.length === 0) return;
    let cancelled = false;
    setLoadingDetails(true);
    setDetailErr(null);
    Promise.all(missing.map((e) => getExam(e.id).catch(() => null)))
      .then((results) => {
        if (cancelled) return;
        setDetails((prev) => {
          const next = { ...prev };
          missing.forEach((e, i) => {
            const r = results[i];
            if (r) next[e.id] = r;
          });
          return next;
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setDetailErr(e instanceof ApiError ? e.message : "failed to load exam details");
      })
      .finally(() => {
        if (!cancelled) setLoadingDetails(false);
      });
    return () => {
      cancelled = true;
    };
  }, [exams, details]);

  const totalQuestions = useMemo(
    () => exams.reduce((s, e) => s + e.question_count, 0),
    [exams],
  );
  const refCount = useMemo(
    () => exams.filter((e) => e.origin === "reference").length,
    [exams],
  );
  const genCount = useMemo(
    () => exams.filter((e) => e.origin === "generated").length,
    [exams],
  );
  const avgQuestions = exams.length > 0 ? totalQuestions / exams.length : 0;
  const avgMinutes =
    exams.length > 0
      ? exams.reduce((s, e) => s + e.total_minutes, 0) / exams.length
      : 0;

  const originData = useMemo(() => {
    const total = refCount + genCount;
    const fmt = (v: number) =>
      total > 0 ? `${v} (${Math.round((v / total) * 100)}%)` : `${v}`;
    return [
      { id: "reference", label: `Reference ${fmt(refCount)}`, value: refCount },
      { id: "generated", label: `Generated ${fmt(genCount)}`, value: genCount },
    ].filter((d) => d.value > 0);
  }, [refCount, genCount]);

  const qcountData = useMemo(
    () =>
      exams
        .slice()
        .sort((a, b) => b.question_count - a.question_count)
        .map((e) => ({ exam: examLabel(e), questions: e.question_count })),
    [exams],
  );

  const difficultyData = useMemo<DiffRow[]>(() => {
    return exams
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((e) => {
        const d = details[e.id];
        const buckets = { D1: 0, D2: 0, D3: 0, D4: 0, D5: 0 };
        if (d) {
          for (const q of d.questions) {
            const lvl = q.difficulty;
            if (lvl != null && lvl >= 1 && lvl <= 5) {
              const key = `D${lvl}` as keyof typeof buckets;
              buckets[key] += 1;
            }
          }
        }
        return { exam: examLabel(e), ...buckets };
      });
  }, [exams, details]);

  const { heatRows, topCategories } = useMemo<{
    heatRows: HeatRow[];
    topCategories: string[];
  }>(() => {
    const catTotals = new Map<string, number>();
    for (const e of exams) {
      const d = details[e.id];
      if (!d) continue;
      for (const q of d.questions) {
        const c = (q.category ?? "uncategorized").trim() || "uncategorized";
        catTotals.set(c, (catTotals.get(c) ?? 0) + 1);
      }
    }
    const top = [...catTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name]) => name);

    const rows: HeatRow[] = exams
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((e) => {
        const d = details[e.id];
        const counts = new Map<string, number>();
        if (d) {
          for (const q of d.questions) {
            const c = (q.category ?? "uncategorized").trim() || "uncategorized";
            counts.set(c, (counts.get(c) ?? 0) + 1);
          }
        }
        return {
          id: examLabel(e),
          data: top.map((cat) => ({ x: cat, y: counts.get(cat) ?? 0 })),
        };
      });
    return { heatRows: rows, topCategories: top };
  }, [exams, details]);

  if (exams.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center text-xs text-slate-500">
        No exams to analyze yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile label="Total exams" value={exams.length.toString()} />
        <KpiTile label="Reference" value={refCount.toString()} accent="text-sky-300" />
        <KpiTile label="Generated" value={genCount.toString()} accent="text-blue-300" />
        <KpiTile label="Avg questions" value={avgQuestions.toFixed(1)} />
        <KpiTile label="Avg minutes" value={avgMinutes.toFixed(0)} />
        <KpiTile label="Total questions" value={totalQuestions.toString()} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Reference vs Generated">
          <div className="h-64">
            <ResponsivePie
              data={originData}
              theme={NIVO_THEME}
              colors={NIVO_COLORS}
              margin={{ top: 20, right: 20, bottom: 40, left: 20 }}
              innerRadius={0.5}
              padAngle={1}
              cornerRadius={3}
              borderWidth={1}
              borderColor={{ from: "color", modifiers: [["darker", 0.4]] }}
              enableArcLabels
              arcLabel={(d) => `${d.value}`}
              arcLabelsTextColor="#0f172a"
              arcLinkLabelsColor={{ from: "color" }}
              arcLinkLabelsTextColor="#cbd5e1"
            />
          </div>
        </ChartCard>

        <ChartCard title="Questions per exam">
          <div className="h-64">
            <ResponsiveBar
              data={qcountData}
              keys={["questions"]}
              indexBy="exam"
              theme={NIVO_THEME}
              colors={NIVO_COLORS}
              margin={{ top: 20, right: 20, bottom: 80, left: 40 }}
              padding={0.3}
              borderRadius={3}
              enableLabel
              label={(d) => `${d.value}`}
              labelTextColor="#0f172a"
              labelSkipHeight={14}
              axisBottom={{ tickRotation: -35 }}
              axisLeft={{ tickValues: 5 }}
            />
          </div>
        </ChartCard>

        <ChartCard
          title="Difficulty profile per exam"
          className="lg:col-span-2"
          loading={loadingDetails}
        >
          <div className="h-80">
            <ResponsiveBar
              data={difficultyData}
              keys={["D1", "D2", "D3", "D4", "D5"]}
              indexBy="exam"
              groupMode="stacked"
              theme={NIVO_THEME}
              colors={NIVO_COLORS}
              margin={{ top: 20, right: 130, bottom: 90, left: 40 }}
              padding={0.3}
              borderRadius={3}
              enableLabel
              label={(d) => (d.value && d.value > 0 ? `${d.value}` : "")}
              labelTextColor="#0f172a"
              labelSkipHeight={12}
              axisBottom={{ tickRotation: -35 }}
              axisLeft={{ tickValues: 5 }}
              legends={[
                {
                  dataFrom: "keys",
                  anchor: "right",
                  direction: "column",
                  translateX: 110,
                  itemWidth: 90,
                  itemHeight: 18,
                  itemTextColor: "#94a3b8",
                  symbolSize: 12,
                  symbolShape: "circle",
                },
              ]}
            />
          </div>
        </ChartCard>

        <ChartCard
          title="Category mix per exam"
          className="lg:col-span-2"
          loading={loadingDetails}
        >
          {topCategories.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-xs text-slate-500">
              No categorized questions yet.
            </div>
          ) : (
            <div style={{ height: Math.max(260, heatRows.length * 36 + 80) }}>
              <ResponsiveHeatMap
                data={heatRows}
                theme={NIVO_THEME}
                margin={{ top: 60, right: 60, bottom: 40, left: 160 }}
                axisTop={{ tickRotation: -35 }}
                axisLeft={{}}
                colors={{
                  type: "sequential",
                  scheme: "blues",
                  minValue: 0,
                }}
                emptyColor="#0f172a"
                labelTextColor="#0f172a"
                borderColor="#0f172a"
                borderWidth={1}
                animate={false}
              />
            </div>
          )}
        </ChartCard>
      </div>

      {detailErr && (
        <div className="rounded-lg border border-red-700/50 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {detailErr}
        </div>
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  accent = "text-slate-100",
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/30 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function examLabel(e: ExamSummary): string {
  return e.title.length > 22 ? `${e.title.slice(0, 21)}…` : e.title;
}

function ChartCard({
  title,
  children,
  className = "",
  loading = false,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  loading?: boolean;
}) {
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/30 p-4 ${className}`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-300">{title}</h3>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
      </div>
      {children}
    </div>
  );
}

function ExamSection({
  title,
  icon,
  exams,
  empty,
  courseId,
  courseCode,
  onDeleted,
  onUpdated,
  selected,
  onToggleOne,
  onToggleMany,
  selectionActive,
}: {
  title: string;
  icon: React.ReactNode;
  exams: ExamSummary[];
  empty: string;
  courseId: string;
  courseCode?: string;
  onDeleted: (id: string) => void;
  onUpdated: (next: ExamSummary) => void;
  selected: Set<string>;
  onToggleOne: (id: string) => void;
  onToggleMany: (ids: string[], on: boolean) => void;
  selectionActive: boolean;
}) {
  const visibleIds = exams.map((e) => e.id);
  const selectedHere = visibleIds.filter((id) => selected.has(id)).length;
  const allSelected = exams.length > 0 && selectedHere === exams.length;
  const partial = selectedHere > 0 && selectedHere < exams.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {exams.length > 0 && (
          <input
            type="checkbox"
            aria-label={`Select all ${title}`}
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = partial;
            }}
            onChange={(ev) => onToggleMany(visibleIds, ev.target.checked)}
            className="h-3.5 w-3.5 accent-blue-500"
          />
        )}
        {icon}
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
          {exams.length}
        </span>
        {selectedHere > 0 && (
          <span className="text-[10px] text-blue-300">{selectedHere} selected</span>
        )}
      </div>

      {exams.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center text-xs text-slate-500">
          {empty}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-800">
          {exams.map((e) => (
            <ExamRow
              key={e.id}
              exam={e}
              courseId={courseId}
              courseCode={courseCode}
              onDeleted={onDeleted}
              onUpdated={onUpdated}
              checked={selected.has(e.id)}
              onToggleSel={() => onToggleOne(e.id)}
              selectionActive={selectionActive}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BulkToolbar({
  count,
  overwrite,
  setOverwrite,
  busy,
  onRender,
  onCompile,
  onDelete,
  onClear,
  note,
  err,
}: {
  count: number;
  overwrite: boolean;
  setOverwrite: (v: boolean) => void;
  busy: "render" | "compile" | "delete" | null;
  onRender: () => void | Promise<void>;
  onCompile: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onClear: () => void;
  note: string | null;
  err: string | null;
}) {
  const anyBusy = busy !== null;
  return (
    <div className="sticky top-2 z-10">
      <div className="rounded-2xl border border-slate-700 bg-slate-900/95 px-3 py-2 shadow-lg backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-200">{count} selected</span>
          <button
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 hover:border-slate-600 hover:text-slate-200"
          >
            <X className="h-3 w-3" />
            Clear
          </button>

          <span className="mx-1 h-4 w-px bg-slate-700" />

          <button
            onClick={() => void onRender()}
            disabled={anyBusy}
            title="Enqueue .tex render for the selected exams"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-[11px] text-slate-200 hover:border-slate-600 disabled:opacity-50"
          >
            {busy === "render" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FileCode className="h-3 w-3" />
            )}
            Render
          </button>

          <button
            onClick={() => void onCompile()}
            disabled={anyBusy}
            title="Enqueue .pdf compilation for the selected exams"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-[11px] text-slate-200 hover:border-slate-600 disabled:opacity-50"
          >
            {busy === "compile" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FileText className="h-3 w-3" />
            )}
            Compile
          </button>

          <button
            onClick={() => void onDelete()}
            disabled={anyBusy}
            title="Delete the selected exams"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-[11px] text-slate-300 hover:border-red-700/60 hover:text-red-400 disabled:opacity-50"
          >
            {busy === "delete" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Delete
          </button>

          <span className="mx-1 h-4 w-px bg-slate-700" />

          <label
            className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-400"
            title="Off — Render skips exams that already have a .tex; Compile skips exams that already have a .pdf. On — redo them."
          >
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(ev) => setOverwrite(ev.target.checked)}
              className="h-3 w-3 accent-amber-500"
            />
            Overwrite
          </label>
        </div>

        {(note || err) && (
          <div className="mt-1.5 text-[11px]">
            {err ? (
              <span className="text-red-400">{err}</span>
            ) : (
              <span className="text-emerald-300">{note}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ExamRow({
  exam,
  courseId,
  courseCode,
  onDeleted,
  onUpdated,
  checked,
  onToggleSel,
  selectionActive,
}: {
  exam: ExamSummary;
  courseId: string;
  courseCode?: string;
  onDeleted: (id: string) => void;
  onUpdated: (next: ExamSummary) => void;
  checked: boolean;
  onToggleSel: () => void;
  selectionActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ExamDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"render" | "compile" | "delete" | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  // Bumped whenever the on-disk .pdf / .tex changes so the iframe re-fetches
  // instead of serving its cached copy of the previous build.
  const [cacheBust, setCacheBust] = useState<number>(() => Date.now());

  const generated = exam.origin === "generated";

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !detail && !loadingDetail) {
      setLoadingDetail(true);
      setDetailErr(null);
      try {
        setDetail(await getExam(exam.id));
      } catch (e) {
        setDetailErr(e instanceof ApiError ? e.message : "failed to load exam");
      } finally {
        setLoadingDetail(false);
      }
    }
  }

  async function pollAfterJob(
    jobName: "render_exam" | "compile_exam_pdf",
    checkField: "tex_path" | "pdf_path",
    timeoutLabel: string,
  ): Promise<void> {
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const fresh = await getExam(exam.id);
        if (fresh[checkField]) {
          onUpdated({
            ...exam,
            status: fresh.status,
            tex_path: fresh.tex_path,
            pdf_path: fresh.pdf_path,
            solution_pdf_path: fresh.solution_pdf_path,
          });
          setDetail(fresh);
          setCacheBust(Date.now());
          return;
        }
      } catch {
        /* keep polling */
      }
    }
    // Timed out from the frontend's perspective. Probe /tasks/ for the
    // most-recent matching job and surface its actual result string so the
    // user sees the real failure (LaTeX error, tectonic missing, etc.).
    try {
      const snap = await listTasks();
      const hit = snap.recent.find(
        (t) => t.name === jobName && (t.args ?? "").includes(exam.id),
      );
      if (hit && hit.status === "error") {
        setActionErr(`${jobName}: ${hit.result ?? "(no error text)"}`);
        return;
      }
      if (hit && hit.status === "ok") {
        // Job actually finished — race with our polling. Just refresh.
        const fresh = await getExam(exam.id);
        onUpdated({
          ...exam,
          status: fresh.status,
          tex_path: fresh.tex_path,
          pdf_path: fresh.pdf_path,
          solution_pdf_path: fresh.solution_pdf_path,
        });
        setDetail(fresh);
        setCacheBust(Date.now());
        return;
      }
    } catch {
      /* fall through to generic message */
    }
    setActionErr(`${timeoutLabel} timed out — see AI → Tasks for the live job state.`);
  }

  async function handleRender(ev: React.MouseEvent) {
    ev.stopPropagation();
    setBusy("render");
    setActionErr(null);
    try {
      await renderExam(exam.id);
      onUpdated({ ...exam, status: "rendering" });
      await pollAfterJob("render_exam", "tex_path", "render");
    } catch (e) {
      setActionErr(e instanceof ApiError ? e.message : "render failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleCompile(ev: React.MouseEvent) {
    ev.stopPropagation();
    setBusy("compile");
    setActionErr(null);
    try {
      await compileExam(exam.id);
      onUpdated({ ...exam, status: "compiling" });
      await pollAfterJob("compile_exam_pdf", "pdf_path", "compile");
    } catch (e) {
      setActionErr(e instanceof ApiError ? e.message : "compile failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(ev: React.MouseEvent) {
    ev.stopPropagation();
    setBusy("delete");
    setActionErr(null);
    try {
      await deleteExam(exam.id);
      onDeleted(exam.id);
    } catch (e) {
      setActionErr(e instanceof ApiError ? e.message : "delete failed");
      setBusy(null);
    }
  }

  return (
    <div className="border-b border-slate-800/70 last:border-b-0">
      {/* summary row */}
      <div
        className={`flex w-full items-center gap-3 px-4 py-3 text-left ${
          checked ? "bg-slate-800/40" : "hover:bg-slate-900/60"
        }`}
      >
        <input
          type="checkbox"
          aria-label={`Select ${exam.title}`}
          checked={checked}
          onChange={onToggleSel}
          onClick={(ev) => ev.stopPropagation()}
          className="h-3.5 w-3.5 shrink-0 accent-blue-500"
        />

        <button
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${
              open ? "rotate-90" : ""
            }`}
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 truncate">
              <span className="truncate text-sm font-medium text-slate-200">{exam.title}</span>
              <span
                className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
                title={`UUID ${exam.id}`}
              >
                {examShortId({ courseCode, uuid: exam.id, origin: exam.origin })}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
              <span>
                {exam.question_count} question{exam.question_count === 1 ? "" : "s"}
              </span>
              <span className="text-slate-700">·</span>
              <span>{exam.total_minutes} min</span>
              <span className="text-slate-700">·</span>
              <span className={STATUS[exam.status] ?? "text-slate-400"}>{exam.status}</span>
              <span className="text-slate-700">·</span>
              <span>{fmtDate(exam.created_at)}</span>
              {VALIDATION[exam.validation_status ?? ""] && (
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    VALIDATION[exam.validation_status!].cls
                  }`}
                  title={
                    exam.open_blocking
                      ? `${exam.open_blocking} blocking finding(s) — compile is refused`
                      : "passed validation"
                  }
                >
                  {VALIDATION[exam.validation_status!].label}
                  {exam.open_blocking ? ` ${exam.open_blocking}` : ""}
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {exam.origin === "reference" && exam.reproduction_score != null && (
              <span
                title={exam.reproduction_notes ?? `${exam.reproduction_score.toFixed(1)} / 10`}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  exam.reproduction_score >= 8
                    ? "bg-emerald-500/15 text-emerald-300"
                    : exam.reproduction_score >= 5
                    ? "bg-amber-500/15 text-amber-300"
                    : "bg-red-500/15 text-red-300"
                }`}
              >
                {exam.reproduction_score.toFixed(1)}/10
              </span>
            )}
            {exam.source_pdf_path && (
              <FileBadge label="src" present={true} />
            )}
            <FileBadge label="tex" present={!!exam.tex_path} />
            <FileBadge label="pdf" present={!!exam.pdf_path} />
            <FileBadge label="sol" present={!!exam.solution_pdf_path} />
          </div>
        </button>
      </div>

      {/* Render/Compile actions — also enabled for reference exams so the user
          can rebuild them from harvested questions and compare to the source. */}
      <div
        className={`flex flex-wrap items-center gap-2 px-4 pb-3 pl-11 ${
          selectionActive ? "opacity-60" : ""
        }`}
        onClick={(ev) => ev.stopPropagation()}
      >
        <button
          onClick={handleRender}
          disabled={busy !== null || exam.question_count === 0}
          title={
            exam.question_count === 0
              ? "Link harvested questions first (Import reference exams)"
              : undefined
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:border-slate-600 disabled:opacity-50"
        >
          {busy === "render" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          Rebuild .tex
        </button>
        <button
          onClick={handleCompile}
          disabled={busy !== null || !exam.tex_path}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:border-slate-600 disabled:opacity-50"
        >
          {busy === "compile" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Hammer className="h-3 w-3" />
          )}
          Compile .pdf
        </button>

          {exam.tex_path && (
            <a
              href={examFileUrl(exam.id, "tex")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-emerald-300 hover:border-slate-600"
            >
              <FileText className="h-3 w-3" />
              .tex
            </a>
          )}
          {exam.pdf_path && (
            <a
              href={examFileUrl(exam.id, "pdf")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-emerald-300 hover:border-slate-600"
            >
              <FileDown className="h-3 w-3" />
              .pdf
            </a>
          )}

          <div className="flex-1" />

          {generated && (
            <button
              onClick={(ev) => {
                ev.stopPropagation();
                setAnalyzeOpen((v) => !v);
              }}
              title="Analyze this exam against materials"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] ${
                analyzeOpen
                  ? "border-blue-700/60 text-blue-300"
                  : "border-slate-700 text-slate-300 hover:border-slate-600"
              }`}
            >
              <Sparkles className="h-3 w-3" />
              Analyze
            </button>
          )}

          <button
            onClick={handleDelete}
            disabled={busy !== null}
            title="Delete exam"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 hover:border-red-700/60 hover:text-red-400 disabled:opacity-50"
          >
            {busy === "delete" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Delete
          </button>
        </div>

      {generated && analyzeOpen && (
        <div
          className="px-4 pb-3 pl-11"
          onClick={(ev) => ev.stopPropagation()}
        >
          <AnalyzePanel
            examId={exam.id}
            courseId={courseId}
            onClose={() => setAnalyzeOpen(false)}
          />
        </div>
      )}

      {/* delete for reference exams */}
      {false && !generated && (
        <div
          className={`flex items-center px-4 pb-3 pl-11 ${
            selectionActive ? "opacity-60" : ""
          }`}
          onClick={(ev) => ev.stopPropagation()}
        >
          <button
            onClick={handleDelete}
            disabled={busy !== null}
            title="Delete exam"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 hover:border-red-700/60 hover:text-red-400 disabled:opacity-50"
          >
            {busy === "delete" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Delete
          </button>
        </div>
      )}

      {actionErr && (
        <div className="px-4 pb-3 pl-11 text-[11px] text-red-400">{actionErr}</div>
      )}

      {/* expanded detail */}
      {open && (
        <div className="border-t border-slate-800/70 bg-slate-950/40 px-4 py-3 pl-11">
          {loadingDetail ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading questions…
            </div>
          ) : detailErr ? (
            <div className="text-xs text-red-400">{detailErr}</div>
          ) : detail ? (
            <>
              <ExamDetailBody detail={detail} />
              <ExamArtefacts exam={exam} onUpdated={onUpdated} cacheBust={cacheBust} />
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ExamDetailBody({ detail }: { detail: ExamDetail }) {
  const qs = detail.questions;
  const pointsTotal = qs.reduce((s, q) => s + (q.points ?? 0), 0);
  const withDiff = qs.filter((q) => q.difficulty != null);
  const avgDiff =
    withDiff.length > 0
      ? withDiff.reduce((s, q) => s + (q.difficulty ?? 0), 0) / withDiff.length
      : null;
  const [detailQid, setDetailQid] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {/* stat line */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
        <span className="font-medium text-slate-200">
          {qs.length} question{qs.length === 1 ? "" : "s"}
        </span>
        <span className="text-slate-700">·</span>
        <span>{pointsTotal} points total</span>
        <span className="text-slate-700">·</span>
        <span>
          avg difficulty {avgDiff != null ? avgDiff.toFixed(1) : "—"}
        </span>
      </div>

      {detail.instructions_md.trim() && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-[11px] text-slate-400">
          {promptPreview(detail.instructions_md)}
        </div>
      )}

      {qs.length === 0 ? (
        <div className="text-xs text-slate-500">No questions in this exam.</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-800">
          {qs
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((q) => (
              <ExamQuestionLine
                key={q.question_id}
                q={q}
                onDetail={(id) => setDetailQid(id)}
              />
            ))}
        </div>
      )}

      {detailQid && (
        <QuestionDetailModal
          questionId={detailQid}
          onClose={() => setDetailQid(null)}
        />
      )}
    </div>
  );
}

function ExamQuestionLine({
  q,
  onDetail,
}: {
  q: ExamQuestionRow;
  onDetail: (questionId: string) => void;
}) {
  const kind = KIND[q.kind] ?? { short: q.kind, cls: "bg-slate-700 text-slate-200" };
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-slate-800/70 px-3 py-2 text-xs last:border-b-0">
      <div className="flex w-32 shrink-0 items-center gap-2">
        <span className="font-mono text-[10px] text-slate-500">#{q.position}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${kind.cls}`}>
          {kind.short}
        </span>
      </div>
      <div className="min-w-0 truncate text-slate-300">{promptPreview(q.prompt_preview)}</div>
      <div className="flex shrink-0 items-center gap-3 text-[11px]">
        <span className="font-mono text-slate-400">D{q.difficulty ?? "—"}</span>
        <span className="font-mono text-slate-400">{q.points} pts</span>
        <button
          onClick={() => onDetail(q.question_id)}
          title="Open question detail (Reading / Source / Edit)"
          className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-blue-700/60 hover:text-blue-200"
        >
          <Search className="h-3 w-3" />
          Detail
        </button>
      </div>
    </div>
  );
}

function ExamArtefacts({
  exam,
  onUpdated,
  cacheBust,
}: {
  exam: ExamSummary;
  onUpdated?: (next: ExamSummary) => void;
  cacheBust?: number;
}) {
  const hasSource = !!exam.source_pdf_path;
  const hasPdf = !!exam.pdf_path;
  const hasTex = !!exam.tex_path;
  const hasSolution = !!exam.solution_pdf_path;
  const defaultTab = hasPdf ? "pdf" : hasSource ? "source" : "tex";
  const [tab, setTab] = useState<"source" | "pdf" | "solution" | "tex">(defaultTab);
  const [comparing, setComparing] = useState(false);
  const [compareErr, setCompareErr] = useState<string | null>(null);

  async function runCompare() {
    setComparing(true);
    setCompareErr(null);
    try {
      await compareExamReproduction(exam.id);
      // Poll for the score to land.
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const fresh = await getExam(exam.id);
          if (fresh.reproduction_score != null) {
            onUpdated?.({ ...exam, reproduction_score: fresh.reproduction_score, reproduction_notes: fresh.reproduction_notes });
            return;
          }
        } catch {
          /* keep polling */
        }
      }
      setCompareErr("compare timed out — see AI → Tasks");
    } catch (e) {
      setCompareErr(e instanceof ApiError ? e.message : "compare failed");
    } finally {
      setComparing(false);
    }
  }

  if (!hasSource && !hasPdf && !hasTex) return null;

  const previewKind: "source" | "pdf" | "solution-pdf" | "tex" =
    tab === "source" ? "source" : tab === "solution" ? "solution-pdf" : tab === "pdf" ? "pdf" : "tex";
  const previewAvailable =
    tab === "source"
      ? hasSource
      : tab === "solution"
      ? hasSolution
      : tab === "pdf"
      ? hasPdf
      : hasTex;

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">Artefacts</div>
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
          {hasSource && (
            <button
              onClick={() => setTab("source")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs ${
                tab === "source" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <FileDown className="h-3 w-3" />
              Source PDF
            </button>
          )}
          <button
            disabled={!hasPdf}
            onClick={() => setTab("pdf")}
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
              tab === "pdf" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <FileDown className="h-3 w-3" />
            {hasSource ? "Reproduced PDF" : "Exam PDF"}
          </button>
          <button
            disabled={!hasSolution}
            onClick={() => setTab("solution")}
            title={hasSolution ? undefined : "Solution PDF is built on the next Compile (after re-render)"}
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
              tab === "solution" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <FileDown className="h-3 w-3" />
            Solution PDF
          </button>
          <button
            disabled={!hasTex}
            onClick={() => setTab("tex")}
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
              tab === "tex" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <FileText className="h-3 w-3" />
            .tex source
          </button>
        </div>
        <div className="flex-1" />
        {hasSource && (
          <a
            href={examFileUrl(exam.id, "source", { download: true })}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-600"
          >
            <FileDown className="h-3 w-3" /> Source
          </a>
        )}
        {hasPdf && (
          <a
            href={examFileUrl(exam.id, "pdf", { download: true })}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-600"
          >
            <FileDown className="h-3 w-3" /> .pdf
          </a>
        )}
        {hasSolution && (
          <a
            href={examFileUrl(exam.id, "solution-pdf", { download: true })}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-600"
          >
            <FileDown className="h-3 w-3" /> solution.pdf
          </a>
        )}
        {hasTex && (
          <a
            href={examFileUrl(exam.id, "tex", { download: true })}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-600"
          >
            <FileText className="h-3 w-3" /> .tex
          </a>
        )}
      </div>

      {hasSource && hasPdf && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
          <span>
            Source ↔ Reproduction match:
            {exam.reproduction_score != null ? (
              <span
                className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  exam.reproduction_score >= 8
                    ? "bg-emerald-500/15 text-emerald-300"
                    : exam.reproduction_score >= 5
                    ? "bg-amber-500/15 text-amber-300"
                    : "bg-red-500/15 text-red-300"
                }`}
              >
                {exam.reproduction_score.toFixed(1)} / 10
              </span>
            ) : (
              <span className="ml-2 text-slate-600">not yet scored</span>
            )}
          </span>
          {exam.reproduction_notes && (
            <span className="text-slate-500" title={exam.reproduction_notes}>
              · {exam.reproduction_notes.slice(0, 90)}{exam.reproduction_notes.length > 90 ? "…" : ""}
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={runCompare}
            disabled={comparing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-700/60 bg-blue-500/10 px-2 py-1 text-[11px] text-blue-200 hover:bg-blue-500/20 disabled:opacity-50"
          >
            {comparing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {exam.reproduction_score != null ? "Re-compare" : "Compare with AI"}
          </button>
        </div>
      )}
      {compareErr && (
        <div className="text-[11px] text-red-300">{compareErr}</div>
      )}

      {tab !== "tex" && previewAvailable && (
        <iframe
          title={`${exam.title} — ${previewKind}`}
          src={examFileUrl(exam.id, previewKind, { v: cacheBust })}
          className="h-[640px] w-full rounded-xl border border-slate-800 bg-slate-950"
        />
      )}
      {tab === "tex" && <ExamSourceEditor exam={exam} />}
    </div>
  );
}

function ExamSourceEditor({ exam }: { exam: ExamSummary }) {
  type Mode = "reading" | "source" | "edit";
  const [files, setFiles] = useState<ExamSourceFile[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("source");
  const [content, setContent] = useState<string>("");
  const [origContent, setOrigContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const dirty = mode === "edit" && content !== origContent;

  const reloadFiles = useCallback(async () => {
    try {
      const r = await listExamSources(exam.id);
      setFiles(r.files);
      setListErr(null);
      if (!active && r.files.length > 0) {
        const preferred =
          r.files.find((f) => f.name === "exam.tex")?.name ??
          r.files.find((f) => f.name === "instructions.tex")?.name ??
          r.files[0]!.name;
        setActive(preferred);
      }
    } catch (e) {
      setListErr(e instanceof ApiError ? e.message : "failed to list sources");
    }
  }, [exam.id, active]);

  useEffect(() => {
    reloadFiles();
  }, [reloadFiles]);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    setSaveErr(null);
    readExamSource(exam.id, active)
      .then((r) => {
        setContent(r.content);
        setOrigContent(r.content);
      })
      .catch((e) => setSaveErr(e instanceof ApiError ? e.message : "failed to read file"))
      .finally(() => setLoading(false));
  }, [exam.id, active]);

  async function save() {
    if (!active) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await writeExamSource(exam.id, active, content);
      setOrigContent(content);
    } catch (e) {
      setSaveErr(e instanceof ApiError ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function doReset() {
    if (!confirm("Reset all per-exam template files (.sty, instructions.tex, exam.tex) from materials/exam-template/?\n\nYour customizations to those files will be lost. Question content is unaffected.")) return;
    setResetting(true);
    setSaveErr(null);
    try {
      await resetExamTemplate(exam.id);
      // Give the worker a moment, then re-list.
      await new Promise((r) => setTimeout(r, 1500));
      await reloadFiles();
      if (active) {
        const r = await readExamSource(exam.id, active);
        setContent(r.content);
        setOrigContent(r.content);
      }
    } catch (e) {
      setSaveErr(e instanceof ApiError ? e.message : "reset failed");
    } finally {
      setResetting(false);
    }
  }

  if (listErr) {
    return <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-xs text-red-400">{listErr}</div>;
  }
  if (files == null) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading sources…
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-xs text-slate-500">
        No source files yet — Rebuild .tex to generate them.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[200px_1fr] gap-3">
      <div className="rounded-xl border border-slate-800 bg-slate-950 p-2">
        <div className="mb-2 px-1 text-[10px] uppercase tracking-wider text-slate-500">Files</div>
        {files.map((f) => (
          <button
            key={f.name}
            onClick={() => {
              if (dirty && !confirm("Discard unsaved edits?")) return;
              setActive(f.name);
              setMode("source");
            }}
            className={`block w-full truncate rounded-md px-2 py-1 text-left text-[12px] font-mono ${
              active === f.name
                ? "bg-slate-800 text-slate-100"
                : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
            }`}
            title={f.name}
          >
            {f.name}
          </button>
        ))}
        <div className="mt-3 border-t border-slate-800 pt-2">
          <button
            onClick={doReset}
            disabled={resetting}
            title="Re-copy .sty / instructions.tex / exam.tex from materials/exam-template/"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-600 disabled:opacity-50"
          >
            {resetting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Reset template
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
            {(["reading", "source", "edit"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  if (dirty && m !== "edit" && !confirm("Discard unsaved edits?")) return;
                  setMode(m);
                }}
                className={`px-3 py-1 text-[11px] capitalize ${
                  mode === m ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {mode === "edit" && (
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileCode className="h-3 w-3" />}
              Save
            </button>
          )}
          {dirty && mode === "edit" && (
            <span className="text-[10px] text-amber-300">unsaved</span>
          )}
        </div>
        {saveErr && <div className="text-[11px] text-red-300">{saveErr}</div>}
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading…
          </div>
        ) : mode === "edit" ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="h-[640px] w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-[12px] leading-relaxed text-slate-200 outline-none focus:border-blue-700"
          />
        ) : mode === "reading" && active?.endsWith(".md") ? (
          <div className="max-h-[640px] overflow-auto rounded-xl border border-slate-800 bg-slate-950 px-4 py-3">
            <MarkdownRenderer markdown={content} />
          </div>
        ) : (
          <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-[11px] leading-relaxed text-slate-200">
            {content}
          </pre>
        )}
        <div className="text-[10px] text-slate-500">
          After editing exam.tex / instructions.tex / *.sty, click <span className="text-slate-300">Compile .pdf</span> to refresh the PDF. The Rebuild .tex button does not overwrite your edits.
        </div>
      </div>
    </div>
  );
}

function AnalyzePanel({
  examId,
  courseId,
  onClose,
}: {
  examId: string;
  courseId: string;
  onClose: () => void;
}) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(true);
  const [materialsErr, setMaterialsErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [result, setResult] = useState<ExamAnalysis | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingMaterials(true);
    listMaterials(courseId)
      .then((list) => {
        if (cancelled) return;
        setMaterials(list.filter((m) => m.extraction_status === "done"));
      })
      .catch((e) => {
        if (cancelled) return;
        setMaterialsErr(e instanceof ApiError ? e.message : "failed to load materials");
      })
      .finally(() => {
        if (!cancelled) setLoadingMaterials(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run() {
    setRunning(true);
    setRunErr(null);
    setResult(null);
    try {
      const ids = [...selected];
      const r = await analyzeExam(examId, ids.length > 0 ? ids : undefined);
      setResult(r);
    } catch (e) {
      setRunErr(e instanceof ApiError ? e.message : "analyze failed");
    } finally {
      setRunning(false);
    }
  }

  const diffEntries = useMemo(() => {
    if (!result) return [] as { key: string; value: number }[];
    return Object.entries(result.difficulty_profile)
      .map(([k, v]) => ({ key: k, value: v }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [result]);

  const diffMax = useMemo(
    () => diffEntries.reduce((m, e) => Math.max(m, e.value), 0),
    [diffEntries],
  );

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-blue-400" />
        <span className="text-xs font-semibold text-slate-200">Analyze this exam</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          title="Close"
          className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="mb-2 text-[11px] text-slate-400">
        Pick reference materials to evaluate against (defaults to none = uses all).
      </div>

      {loadingMaterials ? (
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" /> loading materials…
        </div>
      ) : materialsErr ? (
        <div className="text-[11px] text-red-400">{materialsErr}</div>
      ) : materials.length === 0 ? (
        <div className="text-[11px] text-slate-500">No extracted materials in this course.</div>
      ) : (
        <div className="mb-3 max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/40">
          {materials.map((m) => (
            <label
              key={m.id}
              className="flex cursor-pointer items-center gap-2 border-b border-slate-800/70 px-2.5 py-1.5 text-[11px] text-slate-300 last:border-b-0 hover:bg-slate-900/60"
            >
              <input
                type="checkbox"
                checked={selected.has(m.id)}
                onChange={() => toggle(m.id)}
                className="h-3 w-3 accent-blue-500"
              />
              <span className="min-w-0 flex-1 truncate">{m.title}</span>
              <span className="text-[10px] text-slate-500">{m.collection}</span>
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => void run()}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-700/60 bg-blue-500/10 px-2.5 py-1 text-[11px] text-blue-200 hover:bg-blue-500/20 disabled:opacity-50"
        >
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          Run
        </button>
        <span className="text-[11px] text-slate-500">
          {selected.size === 0
            ? "no materials selected — analysis uses default scope"
            : `${selected.size} selected`}
        </span>
      </div>

      {runErr && (
        <div className="mt-2 rounded-lg border border-red-700/50 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
          {runErr}
        </div>
      )}

      {result && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <KpiTile
              label="Overall difficulty"
              value={
                result.overall_difficulty != null
                  ? result.overall_difficulty.toFixed(2)
                  : "—"
              }
              accent="text-blue-300"
            />
            <KpiTile
              label="Buckets"
              value={diffEntries.length.toString()}
            />
            <KpiTile
              label="Categories"
              value={result.category_mix.length.toString()}
            />
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-3">
            <div className="mb-2 text-[11px] font-semibold text-slate-300">
              Difficulty profile
            </div>
            {diffEntries.length === 0 ? (
              <div className="text-[11px] text-slate-500">No difficulty data.</div>
            ) : (
              <div className="space-y-1.5">
                {diffEntries.map((d) => {
                  const pct = diffMax > 0 ? (d.value / diffMax) * 100 : 0;
                  return (
                    <div key={d.key} className="flex items-center gap-2 text-[11px]">
                      <span className="w-8 font-mono text-slate-400">{d.key}</span>
                      <div className="relative h-3 flex-1 overflow-hidden rounded bg-slate-800">
                        <div
                          className="h-full rounded bg-blue-500/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 text-right font-mono text-slate-300">
                        {d.value}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-3">
            <div className="mb-2 text-[11px] font-semibold text-slate-300">Category mix</div>
            {result.category_mix.length === 0 ? (
              <div className="text-[11px] text-slate-500">No categories.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {result.category_mix.map((c) => (
                  <span
                    key={c.name}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-300"
                  >
                    <span>{c.name}</span>
                    <span className="rounded bg-slate-800 px-1 font-mono text-slate-400">
                      {c.count}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {result.feedback_md.trim() && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-3">
              <div className="mb-2 text-[11px] font-semibold text-slate-300">Feedback</div>
              <div className="prose prose-invert prose-sm max-w-none text-slate-300">
                <MarkdownRenderer markdown={result.feedback_md} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileBadge({ label, present }: { label: string; present: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        present ? "bg-emerald-600/20 text-emerald-300" : "bg-slate-800 text-slate-500"
      }`}
      title={present ? `${label} built` : `${label} not built`}
    >
      {label}
    </span>
  );
}
