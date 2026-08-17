"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Sparkles,
  RefreshCw,
  Save,
  AlertTriangle,
  BookOpen,
  Target,
  ChevronDown,
  Grid3x3,
  ListTree,
  BarChart3,
  Tag,
  Plus,
  Trash2,
} from "lucide-react";
import { ResponsiveBar, type BarSvgProps } from "@nivo/bar";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveHeatMap } from "@nivo/heatmap";
import { ResponsiveTreeMap } from "@nivo/treemap";

type NivoTheme = NonNullable<BarSvgProps<{ id: string }>["theme"]>;

import {
  buildSyllabus,
  discoverChapterCategories,
  getSyllabus,
  putSyllabus,
  listMaterials,
  listQuestions,
  classifyQuestions,
  ApiError,
  type Syllabus,
  type SyllabusChapter,
  type SyllabusElo,
  type Material,
  type Question,
} from "@/lib/api";

const EMPHASIS: Record<string, string> = {
  high: "border-amber-600/50 bg-amber-500/10 text-amber-300",
  medium: "border-blue-600/50 bg-blue-500/10 text-blue-300",
  low: "border-slate-700 bg-slate-800/60 text-slate-400",
};

const EMPHASIS_DOT: Record<string, string> = {
  high: "bg-amber-400",
  medium: "bg-blue-400",
  low: "bg-slate-500",
};

const BLOOM: Record<string, string> = {
  remember: "bg-slate-700 text-slate-200",
  understand: "bg-sky-600/30 text-sky-300",
  apply: "bg-emerald-600/30 text-emerald-300",
  analyze: "bg-violet-600/30 text-violet-300",
  evaluate: "bg-amber-600/30 text-amber-300",
  create: "bg-rose-600/30 text-rose-300",
};

const COVERAGE_COLLECTIONS: { key: string; label: string }[] = [
  { key: "book", label: "book" },
  { key: "lectures", label: "lectures" },
  { key: "exercises", label: "exercises" },
  { key: "exams", label: "exams" },
];

function emphasisKey(raw: string | undefined): "high" | "medium" | "low" {
  const e = (raw ?? "").toLowerCase();
  if (e === "high") return "high";
  if (e === "medium" || e === "med") return "medium";
  return "low";
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type View = "coverage" | "outline" | "charts" | "edit";

const BLOOM_ORDER = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;

const NIVO_COLORS = [
  "#60a5fa",
  "#34d399",
  "#a78bfa",
  "#fbbf24",
  "#f472b6",
  "#22d3ee",
  "#94a3b8",
];

const NIVO_THEME: NivoTheme = {
  background: "transparent",
  text: { fill: "#94a3b8", fontSize: 11 },
  axis: {
    domain: { line: { stroke: "#1e293b" } },
    ticks: {
      line: { stroke: "#1e293b" },
      text: { fill: "#94a3b8" },
    },
    legend: { text: { fill: "#94a3b8" } },
  },
  grid: { line: { stroke: "#1e293b" } },
  labels: { text: { fill: "#e2e8f0" } },
  legends: { text: { fill: "#94a3b8" } },
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

const EMPHASIS_FILL: Record<"high" | "medium" | "low", string> = {
  high: "#fbbf24",
  medium: "#60a5fa",
  low: "#64748b",
};

export function SyllabusPanel({
  courseId,
  initial,
}: {
  courseId: string;
  initial: Syllabus;
}) {
  const [syllabus, setSyllabus] = useState<Syllabus>(initial);
  const [draft, setDraft] = useState(initial.content);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<View>("coverage");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [resyncing, setResyncing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const apply = useCallback((s: Syllabus) => {
    setSyllabus(s);
    setDraft(s.content);
  }, []);

  const loadRelated = useCallback(async () => {
    try {
      const [q, m] = await Promise.all([
        listQuestions(courseId),
        listMaterials(courseId),
      ]);
      setQuestions(q);
      setMaterials(m);
    } catch {
      /* keep stale data */
    }
  }, [courseId]);

  useEffect(() => {
    loadRelated();
  }, [loadRelated]);

  useEffect(() => {
    if (syllabus.status !== "building") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const s = await getSyllabus(courseId);
        if (s.status !== "building") {
          apply(s);
          loadRelated();
        } else {
          setSyllabus(s);
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [syllabus.status, courseId, apply, loadRelated]);

  async function build() {
    setBusy(true);
    setErr(null);
    try {
      await buildSyllabus(courseId);
      setSyllabus({ ...syllabus, status: "building", error: null });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "build failed");
    } finally {
      setBusy(false);
    }
  }

  async function discoverCategories() {
    setBusy(true);
    setErr(null);
    try {
      await discoverChapterCategories(courseId);
      setSyllabus({ ...syllabus, status: "building", error: null });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "discovery failed");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      apply(await putSyllabus(courseId, draft));
      setEditing(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function resync() {
    setResyncing(true);
    setErr(null);
    try {
      const s = await getSyllabus(courseId);
      apply(s);
      await loadRelated();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "resync failed");
    } finally {
      setResyncing(false);
    }
  }

  const building = syllabus.status === "building";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill syllabus={syllabus} />
        <div className="flex-1" />
        {syllabus.exists && (
          <button
            onClick={() => setEditing((v) => !v)}
            disabled={building}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-50"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${editing ? "rotate-180" : ""}`} />
            {editing ? "Hide markdown" : "Edit markdown"}
          </button>
        )}
        <button
          onClick={build}
          disabled={busy || building}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {busy || building ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : syllabus.exists ? (
            <RefreshCw className="h-3.5 w-3.5" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {syllabus.exists ? "Rebuild from materials" : "Build from materials"}
        </button>
        {syllabus.exists && (
          <button
            onClick={discoverCategories}
            disabled={busy || building}
            title="Use the AI to fill in per-chapter category lists"
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-700/60 bg-violet-600/10 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-600/20 disabled:opacity-50"
          >
            <Tag className="h-3.5 w-3.5" />
            Discover categories
          </button>
        )}
        {syllabus.exists && (
          <>
            <ViewToggle view={view} setView={setView} />
            <button
              onClick={resync}
              disabled={resyncing || building}
              title="Re-fetch syllabus, questions and materials"
              className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:border-slate-600 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${resyncing ? "animate-spin" : ""}`} />
            </button>
          </>
        )}
      </div>

      {err && (
        <div className="rounded-lg border border-red-700/50 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}

      {building && !syllabus.exists && (
        <div className="rounded-2xl border border-blue-800/50 bg-blue-500/5 p-6 text-sm text-blue-200/90">
          <Loader2 className="mb-2 h-5 w-5 animate-spin" />
          AI is reading the course description, slides, exercises and past exams to draft the
          course map. This runs in the worker — it may take a minute.
        </div>
      )}

      {building && syllabus.exists && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-800/50 bg-blue-500/5 px-3 py-2 text-xs text-blue-200/90">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          AI is updating the course map in the worker — current data shown below stays usable
          until the run finishes.
        </div>
      )}

      {!syllabus.exists && !building && (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center">
          <Sparkles className="mx-auto mb-3 h-8 w-8 text-slate-600" />
          <div className="text-sm text-slate-300">No course map yet</div>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            Build one and AIEA will infer chapters, expected learning outcomes and exam emphasis
            from the extracted materials. You can edit the result before it drives question
            coverage.
          </p>
        </div>
      )}

      {syllabus.exists && (
        <>
          {editing && (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="min-h-[360px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs leading-relaxed text-slate-200 focus:border-blue-500 focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  onClick={save}
                  disabled={busy || draft === syllabus.content}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save course map
                </button>
              </div>
            </div>
          )}

          {view === "coverage" && (
            <CoverageView
              chapters={syllabus.chapters}
              questions={questions}
              materials={materials}
            />
          )}
          {view === "outline" && <OutlineView syllabus={syllabus} />}
          {view === "edit" && (
            <EditView
              syllabus={syllabus}
              onSaved={(s) => apply(s)}
              save={async (chapters, elos) => {
                const next = buildSyllabusContent(syllabus.content, chapters, elos);
                return await putSyllabus(courseId, next);
              }}
            />
          )}
          {view === "charts" && (
            <ChartsView
              courseId={courseId}
              chapters={syllabus.chapters}
              elos={syllabus.elos}
              questions={questions}
              materials={materials}
              onClassified={loadRelated}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Coverage view ───────────────────────────────────────────────────────────

function CoverageView({
  chapters,
  questions,
  materials,
}: {
  chapters: SyllabusChapter[];
  questions: Question[];
  materials: Material[];
}) {
  const matById = useMemo(() => {
    const m = new Map<string, Material>();
    for (const x of materials) m.set(x.id, x);
    return m;
  }, [materials]);

  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 };
    for (const ch of chapters) c[emphasisKey(ch.emphasis)] += 1;
    return c;
  }, [chapters]);

  const rows = useMemo(
    () =>
      chapters.map((ch) => {
        const ek = emphasisKey(ch.emphasis);
        const refs = ch.materials ?? [];
        const matched = refs.map((ref) => {
          const direct = matById.get(ref);
          if (direct) return direct;
          const nRef = norm(ref);
          return (
            materials.find(
              (m) =>
                norm(m.title) === nRef || norm(m.original_filename) === nRef,
            ) ?? null
          );
        });

        const byCol: Record<string, string[]> = {};
        for (const col of COVERAGE_COLLECTIONS) byCol[col.key] = [];
        const unresolved: string[] = [];
        refs.forEach((ref, i) => {
          const mat = matched[i];
          if (mat && byCol[mat.collection]) {
            byCol[mat.collection].push(mat.title || mat.original_filename);
          } else if (mat) {
            /* material in a non-coverage collection — skip silently */
          } else {
            unresolved.push(ref);
          }
        });

        const qCount = questions.filter((q) => questionMatchesChapter(q, ch)).length;

        return { ch, ek, byCol, unresolved, qCount };
      }),
    [chapters, questions, materials, matById],
  );

  return (
    <div className="space-y-4">
      <EmphasisBar counts={counts} />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-400">
        <span className="font-medium text-slate-300">Legend:</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-emerald-400">✓</span> material tagged
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-slate-600">not tagged</span> no material from this collection
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-amber-400 text-xs">⚠</span> harvested question whose chapter is unset (run Classify)
        </span>
      </div>

      {chapters.length === 0 ? (
        <Empty>No chapters parsed — check the markdown frontmatter.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="min-w-[860px] w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/70 text-left">
                <th className="px-3 py-2 font-medium text-slate-400">Topic / chapter</th>
                <th className="px-3 py-2 font-medium text-slate-400">Emphasis</th>
                {COVERAGE_COLLECTIONS.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-medium text-slate-400">
                    {c.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium text-slate-400">Qs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ ch, ek, byCol, unresolved, qCount }, i) => (
                <tr
                  key={ch.id ?? i}
                  className="border-b border-slate-800/70 last:border-0 hover:bg-slate-900/50"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-slate-500">{ch.id}</span>
                      <span className="font-medium text-slate-100">
                        {ch.title || "(untitled)"}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase ${EMPHASIS[ek]}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${EMPHASIS_DOT[ek]}`} />
                      {ek}
                    </span>
                  </td>
                  {COVERAGE_COLLECTIONS.map((c) => (
                    <td key={c.key} className="px-3 py-2.5 align-top">
                      <CoverageCell items={byCol[c.key]} />
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right">
                    {qCount > 0 ? (
                      <span className="font-medium tabular-nums text-slate-200">{qCount}</span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-amber-400"
                        title="No questions cover this chapter yet"
                      >
                        0 <AlertTriangle className="h-3 w-3" />
                      </span>
                    )}
                    {unresolved.length > 0 && (
                      <div
                        className="mt-0.5 text-[10px] text-slate-600"
                        title={`Unmatched material refs: ${unresolved.join(", ")}`}
                      >
                        {unresolved.length} unmatched
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CoverageCell({ items }: { items: string[] }) {
  if (items.length === 0) {
    return (
      <span
        className="text-[10px] text-slate-600"
        title="No material from this collection is tagged on this chapter"
      >
        not tagged
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-emerald-400" title={`${items.length} material(s) tagged`}>
        ✓
      </span>
      {items.map((it, i) => (
        <span
          key={`${it}-${i}`}
          className="max-w-[140px] truncate rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-400"
          title={it}
        >
          {it}
        </span>
      ))}
    </div>
  );
}

function EmphasisBar({
  counts,
}: {
  counts: { high: number; medium: number; low: number };
}) {
  const total = counts.high + counts.medium + counts.low || 1;
  const segs: { key: "high" | "medium" | "low"; label: string }[] = [
    { key: "high", label: "high" },
    { key: "medium", label: "medium" },
    { key: "low", label: "low" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Exam emphasis
      </span>
      {segs.map((s) => {
        const n = counts[s.key];
        const blocks = Math.max(0, Math.round((n / total) * 8));
        return (
          <div key={s.key} className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">{s.label}</span>
            <span className={`font-mono ${EMPHASIS_DOT[s.key].replace("bg-", "text-")}`}>
              {"█".repeat(Math.max(1, blocks))}
            </span>
            <span className="font-medium tabular-nums text-slate-200">{n}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Charts view ─────────────────────────────────────────────────────────────

function chapterLabel(ch: SyllabusChapter, i: number): string {
  const t = ch.title?.trim();
  if (t) return t.length > 28 ? `${t.slice(0, 27)}…` : t;
  return ch.id ?? `Ch ${i + 1}`;
}

function fuzzyEq(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

function questionMatchesChapter(
  q: Question,
  ch: SyllabusChapter,
): boolean {
  const nId = norm(ch.id ?? "");
  const nTitle = norm(ch.title ?? "");

  const qChapter = norm(q.chapter_id ?? "");
  if (qChapter) {
    if (nId && fuzzyEq(qChapter, nId)) return true;
    if (nTitle && fuzzyEq(qChapter, nTitle)) return true;
  }

  const qCat = norm(q.category ?? "");
  if (qCat) {
    if (nId && fuzzyEq(qCat, nId)) return true;
    if (nTitle && fuzzyEq(qCat, nTitle)) return true;
  }

  for (const t of q.topics ?? []) {
    const nT = norm(t);
    if (!nT) continue;
    if (nId && fuzzyEq(nT, nId)) return true;
    if (nTitle && fuzzyEq(nT, nTitle)) return true;
  }

  return false;
}

function questionsForChapter(
  ch: SyllabusChapter,
  questions: Question[],
): Question[] {
  return questions.filter((q) => questionMatchesChapter(q, ch));
}

const DIFFICULTY_KEYS = ["D1", "D2", "D3", "D4", "D5"] as const;
const DIFFICULTY_COLORS: Record<(typeof DIFFICULTY_KEYS)[number], string> = {
  D1: "#34d399",
  D2: "#60a5fa",
  D3: "#a78bfa",
  D4: "#f59e0b",
  D5: "#ef4444",
};
const SOURCE_COLORS = { reference: "#fbbf24", generated: "#60a5fa" } as const;

function ChartsView({
  courseId,
  chapters,
  elos,
  questions,
  materials,
  onClassified,
}: {
  courseId: string;
  chapters: SyllabusChapter[];
  elos: SyllabusElo[];
  questions: Question[];
  materials: Material[];
  onClassified: () => void | Promise<void>;
}) {
  // Index questions by chapter_id. When chapter_id is null we also try to
  // find a chapter whose canonical categories list contains the question's
  // category — gives a softer bucket while classify hasn't run yet.
  const questionsByChapter = useMemo(() => {
    const map = new Map<string, Question[]>();
    for (const ch of chapters) {
      const id = (ch.id ?? "").trim();
      if (id) map.set(id, []);
    }
    const catLookup = new Map<string, string>(); // category-lowercase → chapter id
    for (const ch of chapters) {
      const id = (ch.id ?? "").trim();
      for (const cat of ch.categories ?? []) {
        const k = cat.trim().toLowerCase();
        if (k && !catLookup.has(k)) catLookup.set(k, id);
      }
    }
    let untagged = 0;
    for (const q of questions) {
      const direct = (q.chapter_id ?? "").trim();
      if (direct && map.has(direct)) {
        map.get(direct)!.push(q);
        continue;
      }
      const cat = (q.category ?? "").trim().toLowerCase();
      const viaCat = cat ? catLookup.get(cat) : undefined;
      if (viaCat && map.has(viaCat)) {
        map.get(viaCat)!.push(q);
        continue;
      }
      untagged += 1;
    }
    return { map, untagged };
  }, [chapters, questions]);

  const classifiedCount = questions.length - questionsByChapter.untagged;
  const untaggedCount = questionsByChapter.untagged;

  const totalCategories = useMemo(
    () => chapters.reduce((s, c) => s + (c.categories?.length ?? 0), 0),
    [chapters],
  );

  // 1. Source mix per chapter (reference vs generated) — horizontal stacked.
  type SourceRow = { chapter: string; reference: number; generated: number };
  const sourceMix = useMemo<SourceRow[]>(
    () =>
      chapters.map((ch, i) => {
        const list = questionsByChapter.map.get((ch.id ?? "").trim()) ?? [];
        const reference = list.filter((q) => q.origin === "harvested").length;
        const generated = list.length - reference;
        return { chapter: chapterLabel(ch, i), reference, generated };
      }),
    [chapters, questionsByChapter],
  );
  const sourceHasData = sourceMix.some((r) => r.reference + r.generated > 0);

  // 2. Difficulty profile per chapter — D1..D5 stacked.
  type DiffRow = SourceRow & Record<(typeof DIFFICULTY_KEYS)[number], number>;
  const difficultyMix = useMemo<DiffRow[]>(
    () =>
      chapters.map((ch, i) => {
        const list = questionsByChapter.map.get((ch.id ?? "").trim()) ?? [];
        const buckets: Record<(typeof DIFFICULTY_KEYS)[number], number> = {
          D1: 0,
          D2: 0,
          D3: 0,
          D4: 0,
          D5: 0,
        };
        for (const q of list) {
          if (q.difficulty != null && q.difficulty >= 1 && q.difficulty <= 5) {
            buckets[`D${q.difficulty}` as (typeof DIFFICULTY_KEYS)[number]] += 1;
          }
        }
        return {
          chapter: chapterLabel(ch, i),
          reference: 0,
          generated: 0,
          ...buckets,
        };
      }),
    [chapters, questionsByChapter],
  );
  const difficultyHasData = difficultyMix.some(
    (r) => r.D1 + r.D2 + r.D3 + r.D4 + r.D5 > 0,
  );

  // 3. Bloom × Chapter heatmap.
  const bloomHeat = useMemo(
    () =>
      chapters.map((ch, i) => {
        const list = questionsByChapter.map.get((ch.id ?? "").trim()) ?? [];
        const cells: Record<string, number> = {};
        for (const b of BLOOM_ORDER) cells[b] = 0;
        for (const q of list) {
          const b = (q.bloom ?? "").toLowerCase();
          if (b in cells) cells[b] += 1;
        }
        return {
          id: chapterLabel(ch, i),
          data: BLOOM_ORDER.map((b) => ({ x: b, y: cells[b] ?? 0 })),
        };
      }),
    [chapters, questionsByChapter],
  );
  const bloomHeatHasData = bloomHeat.some((row) =>
    row.data.some((c) => (c.y ?? 0) > 0),
  );

  // 4. Category coverage treemap (chapter → categories → question count).
  const categoryTree = useMemo(() => {
    const children: { name: string; children: { name: string; loc: number }[] }[] = [];
    for (const ch of chapters) {
      const id = (ch.id ?? "").trim();
      const list = questionsByChapter.map.get(id) ?? [];
      const tally = new Map<string, number>();
      for (const cat of ch.categories ?? []) {
        const k = cat.trim();
        if (k) tally.set(k, 0);
      }
      for (const q of list) {
        const cat = (q.category ?? "").trim();
        if (!cat) continue;
        tally.set(cat, (tally.get(cat) ?? 0) + 1);
      }
      const kids = [...tally.entries()].map(([name, loc]) => ({
        name,
        loc: Math.max(1, loc), // give zero-cells a sliver
      }));
      if (kids.length === 0) continue;
      children.push({ name: chapterLabel(ch, chapters.indexOf(ch)), children: kids });
    }
    return { name: "course", children };
  }, [chapters, questionsByChapter]);
  const categoryTreeHasData = categoryTree.children.length > 0;
  const emptyCategoryCount = useMemo(
    () =>
      chapters.reduce((sum, ch) => {
        const id = (ch.id ?? "").trim();
        const list = questionsByChapter.map.get(id) ?? [];
        const observed = new Set(
          list.map((q) => (q.category ?? "").trim()).filter(Boolean),
        );
        let empty = 0;
        for (const cat of ch.categories ?? []) {
          if (!observed.has(cat.trim())) empty += 1;
        }
        return sum + empty;
      }, 0),
    [chapters, questionsByChapter],
  );

  // 5. Materials × Chapters coverage indicator.
  const materialsHeat = useMemo(() => {
    const cols = COVERAGE_COLLECTIONS;
    const present = (ch: SyllabusChapter, col: string) =>
      (ch.materials ?? []).some((m) => norm(m) === norm(col)) ? 1 : 0;
    return chapters.map((ch, i) => ({
      id: chapterLabel(ch, i),
      data: cols.map((c) => ({ x: c.label, y: present(ch, c.key) })),
    }));
  }, [chapters]);
  const materialsHeatHasData = materialsHeat.some((r) =>
    r.data.some((c) => c.y > 0),
  );

  // 6. Exam emphasis donut (kept — it's compact and useful).
  const emphasisPie = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 };
    for (const ch of chapters) c[emphasisKey(ch.emphasis)] += 1;
    return (["high", "medium", "low"] as const)
      .map((k) => ({
        id: k,
        label: k,
        value: c[k],
        color: EMPHASIS_FILL[k],
      }))
      .filter((d) => d.value > 0);
  }, [chapters]);

  if (chapters.length === 0) {
    return <Empty>No chapters parsed — build or edit the course map first.</Empty>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiTile label="Chapters" value={chapters.length} />
        <KpiTile label="Categories" value={totalCategories} />
        <KpiTile label="ELOs" value={elos.length} />
        <KpiTile label="Classified questions" value={classifiedCount} tone="emerald" />
        <KpiTile
          label="Untagged questions"
          value={untaggedCount}
          tone={untaggedCount > 0 ? "amber" : "muted"}
        />
      </div>

      {untaggedCount > 0 && (
        <ClassifyBanner
          courseId={courseId}
          untagged={untaggedCount}
          onDone={onClassified}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Reference vs generated"
          subtitle="Where each chapter's questions come from"
        >
          {sourceHasData ? (
            <div style={{ height: Math.max(240, chapters.length * 32 + 48) }}>
              <ResponsiveBar<SourceRow>
                data={sourceMix}
                theme={NIVO_THEME}
                keys={["reference", "generated"]}
                indexBy="chapter"
                layout="horizontal"
                groupMode="stacked"
                colors={(bar) => SOURCE_COLORS[bar.id as keyof typeof SOURCE_COLORS]}
                margin={{ top: 8, right: 24, bottom: 36, left: 160 }}
                padding={0.3}
                borderRadius={3}
                enableGridX
                enableGridY={false}
                label={(d) => (d.value ? `${d.value}` : "")}
                labelSkipWidth={14}
                labelTextColor="#0f172a"
                axisBottom={{ tickSize: 0, tickPadding: 6 }}
                axisLeft={{ tickSize: 0, tickPadding: 8 }}
                legends={[
                  {
                    dataFrom: "keys",
                    anchor: "bottom",
                    direction: "row",
                    translateY: 32,
                    itemWidth: 110,
                    itemHeight: 14,
                    itemTextColor: "#94a3b8",
                    symbolSize: 10,
                  },
                ]}
                animate={false}
              />
            </div>
          ) : (
            <ChartEmpty>
              No questions classified to chapters yet — run Classify on the Question Bank.
            </ChartEmpty>
          )}
        </ChartCard>

        <ChartCard
          title="Difficulty profile per chapter"
          subtitle="Stacked count of D1 (easy) → D5 (hard) questions"
        >
          {difficultyHasData ? (
            <div style={{ height: Math.max(240, chapters.length * 32 + 48) }}>
              <ResponsiveBar<DiffRow>
                data={difficultyMix}
                theme={NIVO_THEME}
                keys={[...DIFFICULTY_KEYS]}
                indexBy="chapter"
                layout="horizontal"
                groupMode="stacked"
                colors={(bar) =>
                  DIFFICULTY_COLORS[bar.id as (typeof DIFFICULTY_KEYS)[number]]
                }
                margin={{ top: 8, right: 24, bottom: 36, left: 160 }}
                padding={0.3}
                borderRadius={3}
                enableGridX
                enableGridY={false}
                label={(d) => (d.value ? `${d.value}` : "")}
                labelSkipWidth={14}
                labelTextColor="#0f172a"
                axisBottom={{ tickSize: 0, tickPadding: 6 }}
                axisLeft={{ tickSize: 0, tickPadding: 8 }}
                legends={[
                  {
                    dataFrom: "keys",
                    anchor: "bottom",
                    direction: "row",
                    translateY: 32,
                    itemWidth: 50,
                    itemHeight: 14,
                    itemTextColor: "#94a3b8",
                    symbolSize: 10,
                  },
                ]}
                animate={false}
              />
            </div>
          ) : (
            <ChartEmpty>No difficulty data yet — run Evaluate on questions.</ChartEmpty>
          )}
        </ChartCard>

        <ChartCard
          title="Bloom × chapter"
          subtitle="Cognitive level distribution per chapter (gaps highlight weak coverage)"
        >
          {bloomHeatHasData ? (
            <div style={{ height: Math.max(240, chapters.length * 28 + 64) }}>
              <ResponsiveHeatMap
                data={bloomHeat}
                theme={NIVO_THEME}
                margin={{ top: 28, right: 16, bottom: 16, left: 160 }}
                valueFormat=">-.0f"
                colors={{
                  type: "sequential",
                  scheme: "purples",
                  minValue: 0,
                }}
                emptyColor="#1e293b"
                borderColor="#0f172a"
                borderWidth={1}
                labelTextColor="#0f172a"
                axisTop={{ tickSize: 0, tickPadding: 6, tickRotation: -20 }}
                axisLeft={{ tickSize: 0, tickPadding: 6 }}
                hoverTarget="cell"
                animate={false}
              />
            </div>
          ) : (
            <ChartEmpty>
              No Bloom data yet — Classify or Evaluate fills bloom on each question.
            </ChartEmpty>
          )}
        </ChartCard>

        <ChartCard
          title="Category coverage"
          subtitle={
            emptyCategoryCount > 0
              ? `Treemap of questions per category · ${emptyCategoryCount} categor${emptyCategoryCount === 1 ? "y has" : "ies have"} no questions yet`
              : "Treemap of questions per category"
          }
        >
          {categoryTreeHasData ? (
            <div className="h-80">
              <ResponsiveTreeMap
                data={categoryTree}
                identity="name"
                value="loc"
                theme={NIVO_THEME}
                tile="squarify"
                leavesOnly={false}
                colors={NIVO_COLORS}
                colorBy="id"
                borderColor={{ from: "color", modifiers: [["darker", 0.6]] }}
                labelSkipSize={14}
                label={(n) => (n.data as { name: string }).name}
                labelTextColor="#0f172a"
                parentLabelTextColor="#e2e8f0"
                parentLabelPosition="left"
                animate={false}
              />
            </div>
          ) : (
            <ChartEmpty>
              Categories not discovered yet — click <span className="font-mono">Discover categories</span>.
            </ChartEmpty>
          )}
        </ChartCard>

        <ChartCard
          title="Materials × chapters"
          subtitle="Which material collections each chapter tags"
        >
          {materialsHeatHasData ? (
            <div style={{ height: Math.max(220, chapters.length * 24 + 64) }}>
              <ResponsiveHeatMap
                data={materialsHeat}
                theme={NIVO_THEME}
                margin={{ top: 28, right: 16, bottom: 16, left: 160 }}
                valueFormat=">-.0f"
                colors={{
                  type: "sequential",
                  scheme: "blues",
                  minValue: 0,
                  maxValue: 1,
                }}
                emptyColor="#1e293b"
                borderColor="#0f172a"
                borderWidth={1}
                enableLabels={false}
                axisTop={{ tickSize: 0, tickPadding: 6 }}
                axisLeft={{ tickSize: 0, tickPadding: 6 }}
                hoverTarget="cell"
                animate={false}
              />
            </div>
          ) : (
            <ChartEmpty>
              No materials tagged on chapters yet — edit chapter materials in the Edit view.
            </ChartEmpty>
          )}
        </ChartCard>

        <ChartCard title="Exam emphasis" subtitle="Chapters by emphasis level">
          {emphasisPie.length > 0 ? (
            <div className="h-64">
              <ResponsivePie
                data={emphasisPie}
                theme={NIVO_THEME}
                colors={{ datum: "data.color" }}
                margin={{ top: 16, right: 80, bottom: 16, left: 80 }}
                innerRadius={0.55}
                padAngle={1.5}
                cornerRadius={3}
                borderColor="#0f172a"
                borderWidth={2}
                enableArcLabels
                arcLabel={(d) => `${d.value}`}
                arcLabelsTextColor="#0f172a"
                arcLabelsSkipAngle={10}
                arcLinkLabel={(d) => `${d.id} (${d.value})`}
                arcLinkLabelsColor={{ from: "color" }}
                arcLinkLabelsTextColor="#94a3b8"
                arcLinkLabelsThickness={1}
              />
            </div>
          ) : (
            <ChartEmpty>No chapter emphasis recorded.</ChartEmpty>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "muted" | "emerald" | "amber";
}) {
  const valueClass =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "amber"
        ? "text-amber-300"
        : "text-slate-100";
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}

function ClassifyBanner({
  courseId,
  untagged,
  onDone,
}: {
  courseId: string;
  untagged: number;
  onDone: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [enqueued, setEnqueued] = useState<number | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await classifyQuestions(courseId);
      setEnqueued(res.enqueued);
      await onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "classify failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-700/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-200/90">
      <Tag className="h-4 w-4 text-amber-400" />
      <span>
        <span className="font-semibold text-amber-200">{untagged}</span>{" "}
        question{untagged === 1 ? "" : "s"} need classification.
      </span>
      {enqueued !== null && (
        <span className="text-amber-300/80">
          Enqueued {enqueued} — refresh in a moment.
        </span>
      )}
      {err && <span className="text-red-300">{err}</span>}
      <div className="flex-1" />
      <button
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-600/50 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        Classify all
      </button>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-1 text-sm font-semibold text-slate-200">{title}</div>
      <div className="mb-3 text-[11px] text-slate-500">{subtitle}</div>
      {children}
    </div>
  );
}

function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-800 text-xs text-slate-500">
      {children}
    </div>
  );
}

// ─── Outline view (legacy cards) ─────────────────────────────────────────────

function OutlineView({ syllabus }: { syllabus: Syllabus }) {
  return (
    <>
      <Section icon={BookOpen} title="Chapters" count={syllabus.chapters.length}>
        {syllabus.chapters.length === 0 ? (
          <Empty>No chapters parsed — check the markdown frontmatter.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {syllabus.chapters.map((c, i) => (
              <ChapterCard key={c.id ?? i} chapter={c} />
            ))}
          </div>
        )}
      </Section>

      <Section icon={Target} title="Expected learning outcomes" count={syllabus.elos.length}>
        {syllabus.elos.length === 0 ? (
          <Empty>No ELOs parsed — check the markdown frontmatter.</Empty>
        ) : (
          <div className="space-y-2">
            {syllabus.elos.map((e, i) => (
              <EloRow key={e.id ?? i} elo={e} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

// ─── Shared ──────────────────────────────────────────────────────────────────

function ViewToggle({ view, setView }: { view: View; setView: (v: View) => void }) {
  const opts: { key: View; label: string; icon: typeof Grid3x3 }[] = [
    { key: "coverage", label: "Coverage", icon: Grid3x3 },
    { key: "outline", label: "Outline", icon: ListTree },
    { key: "edit", label: "Edit", icon: Tag },
    { key: "charts", label: "Charts", icon: BarChart3 },
  ];
  return (
    <div className="flex items-center rounded-lg border border-slate-700 p-0.5">
      {opts.map((o) => {
        const I = o.icon;
        const active = view === o.key;
        return (
          <button
            key={o.key}
            onClick={() => setView(o.key)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition ${
              active
                ? "bg-slate-700 text-slate-100"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <I className="h-3.5 w-3.5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function StatusPill({ syllabus }: { syllabus: Syllabus }) {
  const map: Record<Syllabus["status"], { dot: string; text: string; label: string }> = {
    none: { dot: "bg-slate-500", text: "text-slate-400", label: "not built" },
    building: { dot: "bg-blue-500", text: "text-blue-400", label: "building…" },
    ready: { dot: "bg-emerald-500", text: "text-emerald-400", label: "ready" },
    error: { dot: "bg-red-500", text: "text-red-400", label: "error" },
  };
  const s = map[syllabus.status] ?? map.none;
  return (
    <div className="flex items-center gap-2">
      <span className={`flex items-center gap-1.5 text-xs ${s.text}`}>
        <span className={`h-2 w-2 rounded-full ${s.dot}`} />
        Course map {s.label}
      </span>
      {syllabus.status === "error" && syllabus.error && (
        <span className="flex items-center gap-1 text-[11px] text-red-400/80">
          <AlertTriangle className="h-3 w-3" />
          {syllabus.error}
        </span>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof BookOpen;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}

function ChapterCard({ chapter }: { chapter: SyllabusChapter }) {
  const emph = (chapter.emphasis ?? "").toLowerCase();
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-start gap-2">
        <span className="font-mono text-[11px] text-slate-500">{chapter.id}</span>
        <span className="flex-1 text-sm font-medium text-slate-100">
          {chapter.title || "(untitled)"}
        </span>
        {emph && (
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              EMPHASIS[emph] ?? EMPHASIS.low
            }`}
          >
            {emph} emphasis
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(chapter.materials ?? []).map((m) => (
          <span
            key={m}
            className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-400"
          >
            {m}
          </span>
        ))}
        {(chapter.elos ?? []).map((e) => (
          <span
            key={e}
            className="rounded-full border border-slate-700 px-2 py-0.5 font-mono text-[10px] text-slate-400"
          >
            {e}
          </span>
        ))}
      </div>
      {(chapter.categories ?? []).length > 0 && (
        <div className="mt-3 border-t border-slate-800/70 pt-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Categories
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(chapter.categories ?? []).map((c) => (
              <span
                key={c}
                className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EloRow({ elo }: { elo: SyllabusElo }) {
  const bloom = (elo.bloom ?? "").toLowerCase();
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5">
      <span className="font-mono text-[11px] text-slate-500">{elo.id}</span>
      <span className="flex-1 text-sm text-slate-200">{elo.text || "(no text)"}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        {(elo.chapters ?? []).map((c) => (
          <span
            key={c}
            className="rounded-full border border-slate-700 px-2 py-0.5 font-mono text-[10px] text-slate-400"
          >
            {c}
          </span>
        ))}
        {bloom && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${BLOOM[bloom] ?? BLOOM.remember}`}>
            {bloom}
          </span>
        )}
      </div>
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

// ─── Edit view ───────────────────────────────────────────────────────────────

const EMPHASIS_VALUES = ["high", "medium", "low"] as const;
const BLOOM_VALUES = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;

function nextChapterId(existing: SyllabusChapter[]): string {
  const used = new Set(existing.map((c) => (c.id ?? "").toLowerCase()));
  for (let i = 1; i < 10_000; i += 1) {
    const cand = `ch${i}`;
    if (!used.has(cand)) return cand;
  }
  return `ch${Date.now()}`;
}

function nextEloId(existing: SyllabusElo[]): string {
  const used = new Set(existing.map((e) => (e.id ?? "").toLowerCase()));
  for (let i = 1; i < 10_000; i += 1) {
    const cand = `elo${i}`;
    if (!used.has(cand)) return cand;
  }
  return `elo${Date.now()}`;
}

function EditView({
  syllabus,
  save,
  onSaved,
}: {
  syllabus: Syllabus;
  save: (
    chapters: SyllabusChapter[],
    elos: SyllabusElo[],
  ) => Promise<Syllabus>;
  onSaved: (s: Syllabus) => void;
}) {
  const [chapters, setChapters] = useState<SyllabusChapter[]>(() =>
    (syllabus.chapters ?? []).map((c) => ({
      id: c.id ?? "",
      title: c.title ?? "",
      emphasis: c.emphasis ?? "medium",
      materials: c.materials ?? [],
      elos: c.elos ?? [],
      categories: c.categories ?? [],
    })),
  );
  const [elos, setElos] = useState<SyllabusElo[]>(() =>
    (syllabus.elos ?? []).map((e) => ({
      id: e.id ?? "",
      text: e.text ?? "",
      bloom: e.bloom ?? "understand",
      chapters: e.chapters ?? [],
    })),
  );
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  function patchChapter(idx: number, patch: Partial<SyllabusChapter>) {
    setChapters((cs) => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function addChapter() {
    setChapters((cs) => [
      ...cs,
      {
        id: nextChapterId(cs),
        title: "New chapter",
        emphasis: "medium",
        materials: [],
        elos: [],
      },
    ]);
  }
  function deleteChapter(idx: number) {
    setChapters((cs) => cs.filter((_, i) => i !== idx));
  }

  function patchElo(idx: number, patch: Partial<SyllabusElo>) {
    setElos((es) => es.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function addElo() {
    setElos((es) => [
      ...es,
      { id: nextEloId(es), text: "", bloom: "understand", chapters: [] },
    ]);
  }
  function deleteElo(idx: number) {
    setElos((es) => es.filter((_, i) => i !== idx));
  }

  async function onSave() {
    setSaveErr(null);
    setSaveOk(false);
    setSaving(true);
    try {
      const cleanChapters: SyllabusChapter[] = chapters
        .filter((c) => (c.id ?? "").trim())
        .map((c) => ({
          id: (c.id ?? "").trim(),
          title: (c.title ?? "").trim(),
          emphasis: c.emphasis ?? "medium",
          materials: c.materials ?? [],
          elos: c.elos ?? [],
          categories: (c.categories ?? []).map((s) => s.trim()).filter(Boolean),
        }));
      const cleanElos: SyllabusElo[] = elos
        .filter((e) => (e.id ?? "").trim())
        .map((e) => ({
          id: (e.id ?? "").trim(),
          text: (e.text ?? "").trim(),
          bloom: e.bloom ?? "understand",
          chapters: e.chapters ?? [],
        }));
      const updated = await save(cleanChapters, cleanElos);
      onSaved(updated);
      setSaveOk(true);
    } catch (e) {
      setSaveErr(e instanceof ApiError ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  const eloOptions = elos.map((e) => e.id ?? "").filter(Boolean);
  const chapterOptions = chapters.map((c) => c.id ?? "").filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40">
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2.5">
          <BookOpen className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-200">Chapters</h3>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
            {chapters.length}
          </span>
          <div className="flex-1" />
          <button
            onClick={addChapter}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-600"
          >
            <Plus className="h-3.5 w-3.5" />
            Add chapter
          </button>
        </div>
        {chapters.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-500">
            No chapters yet — add one or rebuild from materials.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="w-20 px-3 py-2 font-medium">ID</th>
                  <th className="w-1/4 px-3 py-2 font-medium">Title</th>
                  <th className="w-24 px-3 py-2 font-medium">Emphasis</th>
                  <th className="px-3 py-2 font-medium">Categories (comma-separated)</th>
                  <th className="w-40 px-3 py-2 font-medium">ELOs</th>
                  <th className="w-10 px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {chapters.map((c, idx) => (
                  <tr key={idx} className="border-t border-slate-800">
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={c.id ?? ""}
                        onChange={(e) => patchChapter(idx, { id: e.target.value })}
                        placeholder="ch1"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={c.title ?? ""}
                        onChange={(e) => patchChapter(idx, { title: e.target.value })}
                        placeholder="Chapter title"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={c.emphasis ?? "medium"}
                        onChange={(e) =>
                          patchChapter(idx, { emphasis: e.target.value })
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                      >
                        {EMPHASIS_VALUES.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={(c.categories ?? []).join(", ")}
                        onChange={(e) =>
                          patchChapter(idx, {
                            categories: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="DC circuits / Ohm's law, …"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={(c.elos ?? []).join(", ")}
                        onChange={(e) =>
                          patchChapter(idx, {
                            elos: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="elo1, elo2"
                        list={`elo-ids-${idx}`}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                      />
                      <datalist id={`elo-ids-${idx}`}>
                        {eloOptions.map((e) => (
                          <option key={e} value={e} />
                        ))}
                      </datalist>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => deleteChapter(idx)}
                        className="text-slate-500 hover:text-red-400"
                        title="Delete chapter"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40">
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2.5">
          <Target className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-200">Expected learning outcomes</h3>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
            {elos.length}
          </span>
          <div className="flex-1" />
          <button
            onClick={addElo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-600"
          >
            <Plus className="h-3.5 w-3.5" />
            Add ELO
          </button>
        </div>
        {elos.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-500">
            No ELOs yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="w-24 px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Text</th>
                  <th className="w-28 px-3 py-2 font-medium">Bloom</th>
                  <th className="w-48 px-3 py-2 font-medium">Chapters</th>
                  <th className="w-10 px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {elos.map((e, idx) => (
                  <tr key={idx} className="border-t border-slate-800 align-top">
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={e.id ?? ""}
                        onChange={(ev) => patchElo(idx, { id: ev.target.value })}
                        placeholder="elo1"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <textarea
                        value={e.text ?? ""}
                        onChange={(ev) => patchElo(idx, { text: ev.target.value })}
                        placeholder="The student can …"
                        rows={2}
                        className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={e.bloom ?? "understand"}
                        onChange={(ev) => patchElo(idx, { bloom: ev.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                      >
                        {BLOOM_VALUES.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={(e.chapters ?? []).join(", ")}
                        onChange={(ev) =>
                          patchElo(idx, {
                            chapters: ev.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="ch1, ch2"
                        list={`chap-ids-${idx}`}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                      />
                      <datalist id={`chap-ids-${idx}`}>
                        {chapterOptions.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => deleteElo(idx)}
                        className="text-slate-500 hover:text-red-400"
                        title="Delete ELO"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save chapters & ELOs
        </button>
        {saveOk && <span className="text-xs text-emerald-300">Saved.</span>}
        {saveErr && <span className="text-xs text-red-300">{saveErr}</span>}
        <span className="ml-auto text-[11px] text-slate-500">
          Editing only changes the YAML frontmatter; the prose body of <code>syllabus.md</code> is preserved.
        </span>
      </div>
    </div>
  );
}

// ─── YAML frontmatter builder ────────────────────────────────────────────────

function yamlString(value: string): string {
  if (value === "") return '""';
  if (/^[A-Za-z0-9_\-./ ]+$/.test(value) && !/^[\d-]/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlIdList(ids: string[]): string {
  return `[${ids.map((s) => s).join(", ")}]`;
}

function buildFrontmatter(
  course: string,
  chapters: SyllabusChapter[],
  elos: SyllabusElo[],
): string {
  const lines: string[] = ["---"];
  if (course) lines.push(`course: ${yamlString(course)}`);
  lines.push("chapters:");
  for (const c of chapters) {
    lines.push(`  - id: ${yamlString(c.id ?? "")}`);
    lines.push(`    title: ${yamlString(c.title ?? "")}`);
    if (c.materials && c.materials.length) {
      lines.push(`    materials: [${c.materials.join(", ")}]`);
    } else {
      lines.push(`    materials: []`);
    }
    lines.push(`    emphasis: ${c.emphasis ?? "medium"}`);
    lines.push(`    elos: ${yamlIdList(c.elos ?? [])}`);
    const cats = (c.categories ?? []).filter((s) => s.trim());
    if (cats.length === 0) {
      lines.push(`    categories: []`);
    } else {
      lines.push(`    categories:`);
      for (const cat of cats) lines.push(`      - ${yamlString(cat)}`);
    }
  }
  lines.push("elos:");
  for (const e of elos) {
    lines.push(`  - id: ${yamlString(e.id ?? "")}`);
    lines.push(`    text: ${yamlString(e.text ?? "")}`);
    lines.push(`    bloom: ${e.bloom ?? "understand"}`);
    lines.push(`    chapters: ${yamlIdList(e.chapters ?? [])}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function extractCourseCode(content: string): string {
  const m = content.match(/^course:\s*(.+)$/m);
  if (!m) return "";
  return m[1].trim().replace(/^["']|["']$/g, "");
}

function extractBody(content: string): string {
  // Skip the opening --- and find the closing one. Anything after that is body.
  const lines = content.split("\n");
  if (!lines[0] || lines[0].trim() !== "---") return "";
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      return lines.slice(i + 1).join("\n");
    }
  }
  return "";
}

function buildSyllabusContent(
  prevContent: string,
  chapters: SyllabusChapter[],
  elos: SyllabusElo[],
): string {
  const course = extractCourseCode(prevContent);
  const body = extractBody(prevContent);
  const fm = buildFrontmatter(course, chapters, elos);
  return body.trim() ? `${fm}\n\n${body}` : `${fm}\n`;
}
