"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  RefreshCw,
  ScanSearch,
  Trash2,
  Zap,
  Sparkles,
  Square,
  GitCompare,
  Gauge,
  Star,
  ChevronDown,
  BadgeCheck,
} from "lucide-react";

import {
  aiExtractBatch,
  checkExtracted,
  compareBatch,
  evaluateBatch,
  getExtractionSummary,
  getMaterialVersions,
  ingestBatch,
  listMaterials,
  materialFigureUrl,
  pruneMissingMaterials,
  setFinalBatch,
  stopExtraction,
  verifyExtractions,
  type Course,
  type ExtractionSummary,
  type Material,
  type MaterialVersions,
} from "@/lib/api";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

const COLS = "minmax(200px,1.7fr) 1.15fr 1.5fr 1fr 1.6rem";

const COLLECTIONS: { key: string; label: string }[] = [
  { key: "other", label: "Course description / other" },
  { key: "book", label: "Textbook" },
  { key: "lectures", label: "Lectures & slides" },
  { key: "exercises", label: "Exercises" },
  { key: "exams", label: "Past exams" },
  { key: "exam-template", label: "Exam template" },
];

type Ver = Material["versions"][number];

const EX_TONE: Record<string, string> = {
  pending: "text-slate-500",
  running: "text-blue-400",
  done: "text-emerald-400",
  error: "text-red-400",
};
const EX_GLYPH: Record<string, string> = {
  pending: "·",
  running: "⟳",
  done: "✓",
  error: "✗",
};

function scoreColor(s: number): string {
  return s >= 80 ? "text-emerald-400" : s >= 60 ? "text-amber-400" : "text-red-400";
}

export function ExtractionTable({
  course,
  materials: initial,
}: {
  course: Course;
  materials: Material[];
}) {
  const [materials, setMaterials] = useState<Material[]>(initial);
  const [summary, setSummary] = useState<ExtractionSummary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MaterialVersions | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmFinal, setConfirmFinal] = useState<"python" | "ai" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [owExtract, setOwExtract] = useState(false);
  const [owEval, setOwEval] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([
        listMaterials(course.id),
        getExtractionSummary(course.id),
      ]);
      setMaterials(m);
      setSummary(s);
    } catch {
      /* keep */
    }
  }, [course.id]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await getMaterialVersions(id));
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const h = setInterval(() => {
      refresh();
      if (expandedId) loadDetail(expandedId);
    }, 4000);
    return () => clearInterval(h);
  }, [refresh, expandedId, loadDetail]);

  function toggleSel(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleMany(ids: string[], on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });
  }
  function expand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
    } else {
      setExpandedId(id);
      setDetail(null);
      loadDetail(id);
    }
  }

  async function run(key: string, fn: (ids: string[]) => Promise<string>) {
    const ids = [...selected];
    if (ids.length === 0 && !key.startsWith("course:")) {
      setNote("Select one or more files first.");
      return;
    }
    setBusy(key);
    setNote(null);
    try {
      setNote(await fn(ids));
      await refresh();
      if (expandedId) await loadDetail(expandedId);
    } catch {
      setNote("Action failed.");
    } finally {
      setBusy(null);
    }
  }

  const byCollection = new Map<string, Material[]>();
  for (const m of materials) {
    const a = byCollection.get(m.collection) ?? [];
    a.push(m);
    byCollection.set(m.collection, a);
  }
  const selCount = selected.size;

  return (
    <div className="space-y-4">
      <SummaryBar summary={summary} />

      {note && (
        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
          {note}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-800">
        <div className="min-w-[1080px]">
        {/* ── header band ── */}
        <div className="grid border-b border-slate-800 bg-slate-900/70" style={{ gridTemplateColumns: COLS }}>
          <ColHead n="1" title="Files">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={materials.length > 0 && selCount === materials.length}
                ref={(el) => {
                  if (el) el.indeterminate = selCount > 0 && selCount < materials.length;
                }}
                onChange={(e) =>
                  setSelected(e.target.checked ? new Set(materials.map((m) => m.id)) : new Set())
                }
                className="accent-violet-500"
              />
              select all
            </label>
            <span className="text-[11px] text-slate-500">{selCount} selected</span>
            <div className="flex-1" />
            <Icon busy={busy === "refresh"} onClick={() => run("course:refresh", async () => { await refresh(); return "Refreshed."; })} icon={RefreshCw} title="Refresh" />
            <Icon busy={busy === "verify"} onClick={() => run("course:verify", async () => { const r = await verifyExtractions(course.id); return `Verified — ${r.reconciled} status(es) reconciled with disk.`; })} icon={BadgeCheck} title="Verify — reconcile statuses with the extracted files on disk" />
            <Icon busy={busy === "check"} onClick={() => run("course:check", async () => { const r = await checkExtracted(course.id); return `${r.missing} extracted file(s) missing on disk.`; })} icon={ScanSearch} title="Scan for deleted extracted files" />
            <Icon busy={busy === "prune"} onClick={() => run("course:prune", async () => { const r = await pruneMissingMaterials(course.id); return `Pruned ${r.pruned} material(s).`; })} icon={Trash2} title="Prune materials with no source file" />
          </ColHead>

          <ColHead n="2" title="Extraction">
            <Btn busy={busy === "py"} onClick={() => run("py", async (ids) => { const r = await ingestBatch(ids, owExtract); return `Python: ${r.enqueued} queued, ${r.skipped} skipped.`; })} icon={Zap} label="Python" cls="bg-blue-500 hover:bg-blue-600" />
            <Btn busy={busy === "ai"} onClick={() => run("ai", async (ids) => { const r = await aiExtractBatch(ids, owExtract); return `AI: ${r.enqueued} queued, ${r.skipped} skipped.`; })} icon={Sparkles} label="AI" cls="bg-violet-500 hover:bg-violet-600" />
            <Btn busy={busy === "stop"} onClick={() => run("stop", async (ids) => { const r = await stopExtraction(ids); return `Stopped ${r.stopped} job(s).`; })} icon={Square} label="Stop" cls="bg-red-600 hover:bg-red-700" />
            <OverwriteToggle on={owExtract} set={setOwExtract} />
          </ColHead>

          <ColHead n="3" title="Compare & Evaluate">
            <Btn busy={busy === "compare"} onClick={() => run("compare", async (ids) => { const r = await compareBatch(ids, owEval); return `Compare: ${r.enqueued} queued, ${r.skipped} skipped.`; })} icon={GitCompare} label="Compare" cls="bg-slate-700 hover:bg-slate-600" />
            <Btn busy={busy === "evaluate"} onClick={() => run("evaluate", async (ids) => { const r = await evaluateBatch(ids, owEval); return `Evaluate: ${r.enqueued} queued, ${r.skipped} skipped.`; })} icon={Gauge} label="Evaluate" cls="bg-slate-700 hover:bg-slate-600" />
            <OverwriteToggle on={owEval} set={setOwEval} />
          </ColHead>

          <div className="col-span-2 flex flex-col gap-1.5 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              4 · Final
            </div>
            {confirmFinal ? (
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-amber-300">{selCount} → {confirmFinal}?</span>
                <button
                  onClick={() => run(`final-${confirmFinal}`, async (ids) => { const r = await setFinalBatch(ids, confirmFinal); setConfirmFinal(null); return `${r.finalized} file(s) finalized.`; })}
                  className="rounded bg-emerald-600 px-2 py-0.5 text-white hover:bg-emerald-700"
                >
                  confirm
                </button>
                <button onClick={() => setConfirmFinal(null)} className="text-slate-400 hover:text-slate-200">
                  cancel
                </button>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <Btn busy={false} onClick={() => setConfirmFinal("python")} icon={Star} label="Use Python" cls="bg-slate-700 hover:bg-slate-600" />
                <Btn busy={false} onClick={() => setConfirmFinal("ai")} icon={Star} label="Use AI" cls="bg-slate-700 hover:bg-slate-600" />
              </div>
            )}
          </div>
        </div>

        {/* ── body ── */}
        {materials.length === 0 && (
          <div className="p-10 text-center text-sm text-slate-500">
            No materials. Scan the course first.
          </div>
        )}
        {COLLECTIONS.filter((c) => byCollection.has(c.key)).map((c) => {
          const items = byCollection.get(c.key) ?? [];
          const allOn = items.every((m) => selected.has(m.id));
          return (
            <div key={c.key}>
              <label className="flex items-center gap-2 border-b border-slate-800/70 bg-slate-900/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <input type="checkbox" checked={allOn} onChange={(e) => toggleMany(items.map((m) => m.id), e.target.checked)} className="accent-violet-500" />
                {c.label}
                <span className="text-slate-600">{items.length}</span>
              </label>
              {items.map((m) => (
                <Row
                  key={m.id}
                  material={m}
                  checked={selected.has(m.id)}
                  expanded={expandedId === m.id}
                  detail={expandedId === m.id ? detail : null}
                  onToggleSel={() => toggleSel(m.id)}
                  onExpand={() => expand(m.id)}
                />
              ))}
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}

function ColHead({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-r border-slate-800 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {n} · {title}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function Row({
  material,
  checked,
  expanded,
  detail,
  onToggleSel,
  onExpand,
}: {
  material: Material;
  checked: boolean;
  expanded: boolean;
  detail: MaterialVersions | null;
  onToggleSel: () => void;
  onExpand: () => void;
}) {
  const py = material.versions.find((v) => v.method === "python");
  const ai = material.versions.find((v) => v.method === "ai");
  const finalV = material.versions.find((v) => v.is_final);
  const evalParts: string[] = [];
  if (py?.eval_score != null) evalParts.push(`Py ${py.eval_score}`);
  if (ai?.eval_score != null) evalParts.push(`AI ${ai.eval_score}`);

  return (
    <>
      <div
        className={`grid items-center border-b border-slate-800/70 text-xs ${
          expanded ? "bg-slate-800/50" : "hover:bg-slate-900/50"
        }`}
        style={{ gridTemplateColumns: COLS }}
      >
        {/* col 1 — select + name */}
        <div className="flex items-center gap-2 px-3 py-2">
          <input type="checkbox" checked={checked} onChange={onToggleSel} className="accent-violet-500" />
          <button onClick={onExpand} className="min-w-0 flex-1 truncate text-left text-slate-200">
            {material.title || material.original_filename}
          </button>
        </div>
        {/* col 2 — extraction */}
        <div className="flex items-center gap-3 border-l border-slate-800/70 px-3 py-2">
          <ExBadge label="Py" v={py} />
          <ExBadge label="AI" v={ai} />
        </div>
        {/* col 3 — compare & evaluate */}
        <div className="flex items-center gap-3 border-l border-slate-800/70 px-3 py-2">
          <span className="flex items-center gap-1 text-slate-400">
            <GitCompare className="h-3 w-3 text-slate-600" />
            {material.comparison?.recommend ? (
              <span className="text-emerald-400">{material.comparison.recommend}</span>
            ) : (
              <span className="text-slate-600">—</span>
            )}
          </span>
          <span className="flex items-center gap-1 text-slate-400">
            <Gauge className="h-3 w-3 text-slate-600" />
            {evalParts.length > 0 ? (
              <span>
                {py?.eval_score != null && (
                  <span className={scoreColor(py.eval_score)}>Py {py.eval_score}</span>
                )}
                {py?.eval_score != null && ai?.eval_score != null && " · "}
                {ai?.eval_score != null && (
                  <span className={scoreColor(ai.eval_score)}>AI {ai.eval_score}</span>
                )}
              </span>
            ) : (
              <span className="text-slate-600">—</span>
            )}
          </span>
        </div>
        {/* col 4 — final */}
        <div className="flex items-center gap-1.5 border-l border-slate-800/70 px-3 py-2">
          {finalV ? (
            <span className="flex items-center gap-1 text-emerald-300">
              <Star className="h-3 w-3 fill-emerald-400 text-emerald-400" />
              {finalV.method}
            </span>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </div>
        {/* expand chevron */}
        <button onClick={onExpand} className="flex h-full items-center justify-center text-slate-500 hover:text-slate-200">
          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>
      {expanded && <DetailRow detail={detail} />}
    </>
  );
}

function ExBadge({ label, v }: { label: string; v: Ver | undefined }) {
  if (!v) return <span className="text-slate-600">{label} —</span>;
  return (
    <span className={`flex items-center gap-0.5 ${EX_TONE[v.status]}`}>
      {v.status === "running" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <span>{EX_GLYPH[v.status]}</span>
      )}
      {label}
    </span>
  );
}

const _DETAIL_TABS = [
  { key: "ai", label: "AI extraction" },
  { key: "python", label: "Python extraction" },
  { key: "comparison", label: "Comparison" },
  { key: "evaluation", label: "Evaluation" },
] as const;

function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  return end === -1 ? md : md.slice(end + 4).replace(/^\s+/, "");
}

function DetailRow({ detail }: { detail: MaterialVersions | null }) {
  const [tab, setTab] = useState<"ai" | "python" | "comparison" | "evaluation">("ai");
  const [raw, setRaw] = useState(false);
  if (!detail) {
    return (
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-950/60 px-4 py-4 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading…
      </div>
    );
  }
  const sources: Record<string, string | null> = {
    ai: detail.ai_text,
    python: detail.python_text,
    comparison: detail.comparison_report,
    evaluation: detail.evaluation_report,
  };
  let md = sources[tab];
  if (md) {
    md = stripFrontmatter(md);
    if (tab === "ai") {
      md = md.replace(
        /\]\(attachments\/([^)\s]+\.png)\)/g,
        (_m, name) => `](${materialFigureUrl(detail.material_id, name, "ai")})`,
      );
    }
  }
  return (
    <div className="space-y-3 border-b border-slate-800 bg-slate-950/60 p-3">
      <FilesPanel detail={detail} />
      <div className="rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="flex items-center gap-1 border-b border-slate-800 px-2 py-1.5">
          {_DETAIL_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition ${
                tab === t.key ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={() => setRaw((v) => !v)}
            className="ml-auto rounded px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300"
            title="Toggle rendered / source view"
          >
            {raw ? "rendered" : "source"}
          </button>
        </div>
        <div className="max-h-[36rem] overflow-auto p-4">
          {md ? (
            raw ? (
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-400">
                {md}
              </pre>
            ) : (
              <MarkdownRenderer markdown={md} />
            )
          ) : (
            <div className="text-[11px] text-slate-600">— not available yet —</div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilesPanel({ detail }: { detail: MaterialVersions }) {
  const anyPath =
    detail.python_path ?? detail.ai_path ?? detail.comparison_path ?? detail.evaluation_path;
  if (!anyPath) return null;
  const root = `${anyPath.split("/extracted/")[0]}/extracted`;
  const isFinal = detail.versions.some((v) => v.is_final);
  const mark = (ok: boolean, miss: string) => (ok ? "✓" : `— ${miss}`);
  const lines = [
    `${root}/`,
    `  <id> = ${detail.material_id}`,
    "",
    `  py/<id>/extracted.md            ${mark(detail.python_text != null, "not extracted")}`,
    `  ai/<id>/extracted.md            ${mark(detail.ai_text != null, "not extracted")}`,
    `  ai/<id>/pages/                  rendered page images`,
    `  comparison/<id>/comparison.md   ${mark(detail.comparison_report != null, "not run")}`,
    `  comparison/<id>/evaluation.md   ${mark(detail.evaluation_report != null, "not run")}`,
    `  final/<id>/extracted.md         ${mark(isFinal, "none selected")}`,
  ];
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="border-b border-slate-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Files on disk
      </div>
      <pre className="select-all overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-slate-400">
        {lines.join("\n")}
      </pre>
    </div>
  );
}

function SummaryBar({ summary }: { summary: ExtractionSummary | null }) {
  if (!summary) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-slate-500">
        Loading extraction overview…
      </div>
    );
  }
  const { materials, python, ai, evaluated, compared, final_set, no_extraction } = summary;
  const pct = materials > 0 ? Math.round((final_set / materials) * 100) : 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Card label="Materials" value={materials}>
        {no_extraction > 0 ? (
          <span className="text-amber-400">{no_extraction} not extracted</span>
        ) : (
          <span className="text-slate-500">all extracted</span>
        )}
      </Card>
      <Card label="Python" value={python.done} accent="text-blue-300">
        <Chips running={python.running} error={python.error} />
      </Card>
      <Card label="AI" value={ai.done} accent="text-violet-300">
        <Chips running={ai.running} error={ai.error} />
      </Card>
      <Card label="Evaluated" value={evaluated}>
        <span className="text-slate-500">of {materials}</span>
      </Card>
      <Card label="Compared" value={compared}>
        <span className="text-slate-500">py vs ai</span>
      </Card>
      <Card label="Final" value={`${final_set} / ${materials}`} accent="text-emerald-300">
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
      </Card>
    </div>
  );
}

function Card({
  label,
  value,
  accent,
  children,
}: {
  label: string;
  value: string | number;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 text-2xl font-semibold tabular-nums ${accent ?? "text-slate-100"}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px]">{children}</div>
    </div>
  );
}

function Chips({ running, error }: { running: number; error: number }) {
  return (
    <span className="flex gap-2">
      <span className="text-slate-500">{running} running</span>
      <span className={error > 0 ? "text-red-400" : "text-slate-500"}>{error} failed</span>
    </span>
  );
}

function Icon({
  onClick,
  busy,
  icon: I,
  title,
}: {
  onClick: () => void;
  busy: boolean;
  icon: typeof RefreshCw;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={title}
      className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:border-slate-600 disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <I className="h-3.5 w-3.5" />}
    </button>
  );
}

function OverwriteToggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <label
      className="flex items-center gap-1 text-[11px] text-slate-400"
      title="Off — skip files already done. On — redo them."
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => set(e.target.checked)}
        className="accent-amber-500"
      />
      overwrite
    </label>
  );
}

function Btn({
  onClick,
  busy,
  icon: I,
  label,
  cls,
}: {
  onClick: () => void;
  busy: boolean;
  icon: typeof Zap;
  label: string;
  cls: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50 ${cls}`}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <I className="h-3 w-3" />}
      {label}
    </button>
  );
}
