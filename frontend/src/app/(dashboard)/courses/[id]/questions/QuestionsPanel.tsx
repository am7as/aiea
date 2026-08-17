"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Sparkles,
  Loader2,
  X,
  ChevronRight,
  Trash2,
  RefreshCw,
  Image as ImageIcon,
  Bot,
  BookOpen,
  CheckCircle2,
  Scissors,
  Search,
  ListChecks,
  BarChart3,
  PenLine,
  Gauge,
  MessageSquare,
  Tags,
} from "lucide-react";
import { ResponsiveBar } from "@nivo/bar";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveRadar } from "@nivo/radar";
import { ResponsiveTreeMap } from "@nivo/treemap";

import {
  ApiError,
  answerQuestion,
  answerQuestionsBatch,
  classifyQuestions,
  deleteQuestion,
  deleteQuestionsBatch,
  evaluateQuestion,
  evaluateQuestionsBatch,
  feedbackQuestion,
  feedbackQuestionsBatch,
  getSyllabus,
  harvestQuestions,
  listMaterials,
  listQuestions,
  questionFigureUrl,
  reconcileQuestions,
  type Material,
  type Question,
  type QuestionKind,
  type SyllabusChapter,
} from "@/lib/api";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

const KIND: Record<string, { label: string; short: string; cls: string }> = {
  mcq: { label: "MCQ", short: "mcq", cls: "bg-blue-600/30 text-blue-300" },
  short: { label: "Short answer", short: "short", cls: "bg-emerald-600/30 text-emerald-300" },
  essay: { label: "Essay", short: "essay", cls: "bg-violet-600/30 text-violet-300" },
  problem: { label: "Problem", short: "prob", cls: "bg-amber-600/30 text-amber-300" },
  code: { label: "Code", short: "code", cls: "bg-rose-600/30 text-rose-300" },
  true_false: { label: "True / False", short: "t/f", cls: "bg-sky-600/30 text-sky-300" },
};

const BLOOM: Record<string, string> = {
  remember: "text-slate-300",
  understand: "text-sky-300",
  apply: "text-emerald-300",
  analyze: "text-violet-300",
  evaluate: "text-amber-300",
  create: "text-rose-300",
};

const KINDS: QuestionKind[] = ["mcq", "short", "essay", "problem", "code", "true_false"];
const BLOOMS = ["remember", "understand", "apply", "analyze", "evaluate", "create"];
const STATUSES = ["draft", "generated", "evaluating", "ready", "in_exam", "archived"];
const ORIGINS = ["ai-generated", "harvested"];

const UNCATEGORIZED = "Uncategorized";
const UNASSIGNED_CHAPTER = "__unassigned__";

type ChapterGroup = {
  key: string; // chapter_id or UNASSIGNED_CHAPTER
  label: string; // display label
  total: number;
  cats: { name: string; questions: Question[] }[];
};

type BulkAction = "answer" | "evaluate" | "feedback" | "classify" | "delete";

const selectCls =
  "rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none";

// ─── Nivo dark theme ──────────────────────────────────────────────────────────
const CHART_COLORS = ["#6f8fc7", "#7fae9b", "#b9a06f", "#a98fc0", "#c08a8a", "#7fa8b9"];

const nivoTheme = {
  text: { fill: "#94a3b8", fontSize: 11 },
  axis: {
    ticks: { text: { fill: "#94a3b8", fontSize: 10 } },
    legend: { text: { fill: "#94a3b8" } },
    domain: { line: { stroke: "#1e293b" } },
  },
  grid: { line: { stroke: "#1e293b" } },
  legends: { text: { fill: "#94a3b8" } },
  labels: { text: { fill: "#e2e8f0" } },
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

const PREVIEW_LIMIT = 280;

// Rewrites vault-relative figure refs (`figures/<fig>.png`, or the legacy
// `figures/<id>/<fig>.png`) to the API endpoint that serves them, so the
// browser doesn't resolve them against the current page URL (→ 404).
const FIGURE_RE = /\]\(figures\/(?:[^/]+\/)?([^)\s]+\.png)\)/g;

function rewriteFigures(md: string, questionId: string): string {
  return md.replace(FIGURE_RE, (_m, name: string) => `](${questionFigureUrl(questionId, name)})`);
}

function promptPreview(md: string): string {
  let body = md.trim();
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(end + 4).trimStart();
  }
  body = body.replace(/^\s*#{1,6}\s+.*\n+/g, "").trimStart();
  if (body.length > PREVIEW_LIMIT) {
    body = body.slice(0, PREVIEW_LIMIT).trimEnd() + "…";
  }
  return body;
}

function scoreColor(s: number): string {
  return s >= 8 ? "text-emerald-400" : s >= 6 ? "text-amber-400" : "text-red-400";
}

function questionHasFigures(q: Question): boolean {
  return q.source_pages.length > 0 || q.prompt_md.includes("![");
}

export function QuestionsPanel({
  courseId,
  initialQuestions,
}: {
  courseId: string;
  initialQuestions: Question[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // sessionStorage backs the URL params — Next.js App Router cache occasionally
  // drops query params on back-navigation, so we restore from sessionStorage
  // when the URL is empty. URL wins when present (shareable filter links).
  const storageKey = `aiea.qb.filters.${courseId}`;
  const readSaved = useCallback((field: string, fallback: string): string => {
    if (typeof window === "undefined") return fallback;
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
      return stored[field] ?? fallback;
    } catch {
      return fallback;
    }
  }, [storageKey]);

  const [questions, setQuestions] = useState<Question[]>(initialQuestions);
  const [chapters, setChapters] = useState<SyllabusChapter[]>([]);
  const [fChapter, setFChapter] = useState(() =>
    searchParams.get("chapter") ?? readSaved("chapter", ""),
  );
  const [fCategory, setFCategory] = useState(() =>
    searchParams.get("category") ?? readSaved("category", ""),
  );
  const [fStatus, setFStatus] = useState(() =>
    searchParams.get("status") ?? readSaved("status", ""),
  );
  const [fKind, setFKind] = useState(() =>
    searchParams.get("kind") ?? readSaved("kind", ""),
  );
  const [fOrigin, setFOrigin] = useState(() =>
    searchParams.get("origin") ?? readSaved("origin", ""),
  );
  const [search, setSearch] = useState(() =>
    searchParams.get("q") ?? readSaved("q", ""),
  );

  useEffect(() => {
    let alive = true;
    void getSyllabus(courseId)
      .then((s) => {
        if (alive) setChapters(s.chapters ?? []);
      })
      .catch(() => {
        /* syllabus optional */
      });
    return () => {
      alive = false;
    };
  }, [courseId]);

  const chapterLabelOf = useCallback(
    (chapterId: string | null | undefined): { key: string; label: string } => {
      const cid = (chapterId ?? "").trim();
      if (!cid) return { key: UNASSIGNED_CHAPTER, label: "Unassigned chapter" };
      const match = chapters.find((c) => (c.id ?? "") === cid);
      const title = match?.title?.trim();
      return { key: cid, label: title ? `${cid} — ${title}` : cid };
    },
    [chapters],
  );
  const [view, setView] = useState<"list" | "distribution">("list");
  const [harvestDialog, setHarvestDialog] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [classifying, setClassifying] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<BulkAction | null>(null);
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setResyncing(true);
    try {
      const recon = await reconcileQuestions(courseId);
      const fresh = await listQuestions(courseId);
      setQuestions(fresh);
      if (recon.removed > 0) {
        setNote(`Resync: dropped ${recon.removed} question(s) whose vault folder was missing.`);
      }
    } catch {
      /* keep current */
    } finally {
      setResyncing(false);
    }
  }, [courseId]);

  const unclassified = useMemo(
    () => questions.filter((q) => !q.category || !q.category.trim()).length,
    [questions],
  );

  const runClassify = useCallback(async () => {
    const target = unclassified || questions.length;
    if (target === 0) return;
    setClassifying(target);
    try {
      await classifyQuestions(courseId);
      setNote(`Classifying ${target} question(s)… Resync once it finishes.`);
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "classify failed to start");
    } finally {
      setClassifying(null);
    }
  }, [courseId, questions.length, unclassified]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const q of questions) set.add(q.category?.trim() || UNCATEGORIZED);
    return [...set].sort((a, b) =>
      a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : a.localeCompare(b),
    );
  }, [questions]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return questions.filter((q) => {
      if (fStatus && q.status !== fStatus) return false;
      if (fKind && q.kind !== fKind) return false;
      if (fOrigin && q.origin !== fOrigin) return false;
      if (fCategory && (q.category?.trim() || UNCATEGORIZED) !== fCategory) return false;
      if (fChapter) {
        const qch = (q.chapter_id ?? "").trim() || UNASSIGNED_CHAPTER;
        if (qch !== fChapter) return false;
      }
      if (needle) {
        const hay = [q.prompt_md, q.category ?? "", q.source_ref ?? "", q.id]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [questions, fStatus, fKind, fOrigin, fCategory, fChapter, search]);

  // Chapter → categories → questions, in syllabus order.
  const chapterGroups = useMemo<ChapterGroup[]>(() => {
    const chapterOrder: string[] = chapters.map((c) => (c.id ?? "").trim()).filter(Boolean);
    const buckets = new Map<string, Map<string, Question[]>>();
    for (const q of visible) {
      const { key } = chapterLabelOf(q.chapter_id);
      if (!buckets.has(key)) buckets.set(key, new Map());
      const inner = buckets.get(key)!;
      const cat = q.category?.trim() || UNCATEGORIZED;
      const arr = inner.get(cat) ?? [];
      arr.push(q);
      inner.set(cat, arr);
    }
    const keys = [...buckets.keys()].sort((a, b) => {
      if (a === UNASSIGNED_CHAPTER) return 1;
      if (b === UNASSIGNED_CHAPTER) return -1;
      const ai = chapterOrder.indexOf(a);
      const bi = chapterOrder.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return keys.map((key) => {
      const inner = buckets.get(key)!;
      const cats = [...inner.entries()]
        .sort(([a], [b]) =>
          a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : a.localeCompare(b),
        )
        .map(([name, items]) => ({ name, questions: items }));
      const total = cats.reduce((sum, c) => sum + c.questions.length, 0);
      const { label } = chapterLabelOf(key === UNASSIGNED_CHAPTER ? "" : key);
      return { key, label, total, cats };
    });
  }, [visible, chapters, chapterLabelOf]);

  const counts = useMemo(() => {
    let ready = 0;
    let aiGen = 0;
    let harvested = 0;
    for (const q of visible) {
      if (q.status === "ready" || q.status === "in_exam") ready += 1;
      if (q.origin === "harvested") harvested += 1;
      else aiGen += 1;
    }
    return { ready, aiGen, harvested };
  }, [visible]);

  function toggleGroup(cat: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(cat)) n.delete(cat);
      else n.add(cat);
      return n;
    });
  }

  const visibleIds = useMemo(() => visible.map((q) => q.id), [visible]);
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);

  useEffect(() => {
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visibleIdSet.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [visibleIdSet]);

  // Mirror filter state into (a) sessionStorage and (b) the URL bar so back-
  // navigation from a question detail restores the previous filter. We use
  // window.history.replaceState directly rather than router.replace because
  // Next.js App Router's router cache occasionally serves a stale render
  // (without the params) on back-nav; the sessionStorage fallback above
  // restores state regardless.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const state = {
      chapter: fChapter,
      category: fCategory,
      status: fStatus,
      kind: fKind,
      origin: fOrigin,
      q: search.trim(),
    };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* sessionStorage may be disabled — that's fine, URL still works */
    }
    const next = new URLSearchParams();
    for (const [key, val] of Object.entries(state)) {
      if (val) next.set(key, val);
    }
    const desired = next.toString();
    const currentUrl = window.location.search.replace(/^\?/, "");
    if (currentUrl !== desired) {
      const newUrl = `${pathname}${desired ? `?${desired}` : ""}`;
      window.history.replaceState({}, "", newUrl);
    }
  }, [fChapter, fCategory, fStatus, fKind, fOrigin, search, pathname, storageKey]);

  const hasActiveFilters =
    !!fChapter || !!fCategory || !!fStatus || !!fKind || !!fOrigin || !!search.trim();

  const clearFilters = useCallback(() => {
    setFChapter("");
    setFCategory("");
    setFStatus("");
    setFKind("");
    setFOrigin("");
    setSearch("");
  }, []);

  const toggleOne = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const toggleMany = useCallback((ids: string[], on: boolean) => {
    setSelected((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));

  const runBulk = useCallback(
    async (action: BulkAction) => {
      if (selected.size === 0) return;
      const ids = [...selected];
      setBulkBusy(action);
      setBulkNote(null);
      try {
        if (action === "answer") {
          const r = await answerQuestionsBatch(ids, overwrite);
          setBulkNote(`Answer — enqueued ${r.enqueued} · skipped ${r.skipped}`);
          clearSelection();
        } else if (action === "evaluate") {
          const r = await evaluateQuestionsBatch(ids, overwrite);
          setBulkNote(`Evaluate — enqueued ${r.enqueued} · skipped ${r.skipped}`);
          clearSelection();
        } else if (action === "feedback") {
          const r = await feedbackQuestionsBatch(ids, overwrite);
          setBulkNote(`Feedback — enqueued ${r.enqueued} · skipped ${r.skipped}`);
          clearSelection();
        } else if (action === "classify") {
          const r = await classifyQuestions(courseId, ids);
          setBulkNote(`Classify — enqueued ${r.enqueued}`);
          clearSelection();
        } else if (action === "delete") {
          if (!confirm(`Delete ${ids.length} question(s)? This cannot be undone.`)) {
            setBulkBusy(null);
            return;
          }
          const r = await deleteQuestionsBatch(ids);
          setBulkNote(`Deleted ${r.deleted} question(s)`);
          clearSelection();
          await refresh();
        }
      } catch (e) {
        setBulkNote(e instanceof ApiError ? e.message : `${action} failed`);
      } finally {
        setBulkBusy(null);
      }
    },
    [selected, overwrite, courseId, clearSelection, refresh],
  );

  const viewToggleCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
      active ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
    }`;

  return (
    <div className="space-y-4">
      {/* ── view toggle ── */}
      <div className="flex items-center justify-between">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
          <button onClick={() => setView("list")} className={viewToggleCls(view === "list")}>
            <ListChecks className="h-3.5 w-3.5" />
            List
          </button>
          <button
            onClick={() => setView("distribution")}
            className={viewToggleCls(view === "distribution")}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Distribution
          </button>
        </div>
        {classifying != null && (
          <span className="flex items-center gap-1.5 text-xs text-blue-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> classifying {classifying}…
          </span>
        )}
      </div>

      {/* ── toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prompt, category, source, id…"
            className="w-64 rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-7 pr-7 text-xs text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <select
          className={selectCls}
          value={fChapter}
          onChange={(e) => setFChapter(e.target.value)}
        >
          <option value="">all chapters</option>
          {chapters.map((c) => (
            <option key={c.id ?? ""} value={c.id ?? ""}>
              {c.id}{c.title ? ` — ${c.title}` : ""}
            </option>
          ))}
          <option value={UNASSIGNED_CHAPTER}>(unassigned)</option>
        </select>
        <select
          className={selectCls}
          value={fCategory}
          onChange={(e) => setFCategory(e.target.value)}
        >
          <option value="">all categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className={selectCls} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">all statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className={selectCls} value={fKind} onChange={(e) => setFKind(e.target.value)}>
          <option value="">all types</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND[k].label}
            </option>
          ))}
        </select>
        <select className={selectCls} value={fOrigin} onChange={(e) => setFOrigin(e.target.value)}>
          <option value="">all origins</option>
          {ORIGINS.map((o) => (
            <option key={o} value={o}>
              {o === "ai-generated" ? "AI generated" : "harvested"}
            </option>
          ))}
        </select>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            title="Clear all filters"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
            Clear filters
          </button>
        )}

        <div className="flex-1" />

        <button
          onClick={() => setHarvestDialog(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-700/60 bg-amber-600/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-600/20"
        >
          <Scissors className="h-3.5 w-3.5" />
          Harvest
        </button>
        <button
          onClick={runClassify}
          disabled={classifying != null || questions.length === 0}
          title={
            unclassified > 0
              ? `Classify ${unclassified} unset question(s)`
              : "Re-classify all questions"
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-700/60 bg-violet-600/10 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-600/20 disabled:opacity-50"
        >
          {classifying != null ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Tags className="h-3.5 w-3.5" />
          )}
          Classify
        </button>
        <button
          onClick={refresh}
          disabled={resyncing}
          title="Resync — re-fetch the question list"
          className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:border-slate-600 disabled:opacity-50"
        >
          {resyncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* ── summary line ── */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
        <span className="font-medium text-slate-200">
          {visible.length} question{visible.length === 1 ? "" : "s"}
        </span>
        <span className="text-slate-600">·</span>
        <span className="text-emerald-400">{counts.ready} ready</span>
        <span className="text-slate-600">·</span>
        <span className="text-blue-400">{counts.aiGen} AI</span>
        <span className="text-slate-600">·</span>
        <span className="text-amber-400">{counts.harvested} reference</span>
        {visible.length !== questions.length && (
          <span className="text-slate-600">— filtered from {questions.length}</span>
        )}
      </div>

      {note && (
        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
          {note}
        </div>
      )}

      {/* ── unassigned-chapter banner ── */}
      {view === "list" && (() => {
        const unassigned = questions.filter(
          (q) => !(q.chapter_id ?? "").trim(),
        );
        if (unassigned.length === 0) return null;
        const harvested = unassigned.filter((q) => q.origin === "harvested").length;
        return (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-700/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-200/90">
            <Tags className="h-4 w-4 text-amber-400" />
            <span>
              <span className="font-semibold text-amber-200">{unassigned.length}</span>{" "}
              question{unassigned.length === 1 ? "" : "s"} have no chapter yet
              {harvested > 0 && (
                <span className="text-amber-300/80"> · {harvested} harvested</span>
              )}
              . Classify so each lands under the right chapter / category folder.
            </span>
            <div className="flex-1" />
            {selected.size > 0 && (
              <button
                onClick={() => runBulk("classify")}
                disabled={bulkBusy != null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-600/50 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
              >
                {bulkBusy === "classify" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Tags className="h-3.5 w-3.5" />
                )}
                Classify selected ({selected.size})
              </button>
            )}
            <button
              onClick={runClassify}
              disabled={classifying != null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-amber-400 disabled:opacity-50"
            >
              {classifying != null ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Classify all unassigned
            </button>
          </div>
        );
      })()}

      {/* ── bulk-action toolbar (sticky when selection > 0) ── */}
      {view === "list" && selected.size > 0 && (
        <div className="sticky top-0 z-20 -mx-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-violet-700/50 bg-slate-900/95 px-3 py-2 shadow-lg shadow-black/30 backdrop-blur">
            <span className="text-xs font-medium text-violet-200">{selected.size} selected</span>
            <button
              onClick={clearSelection}
              className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-400 hover:border-slate-600 hover:text-slate-200"
              title="Clear selection"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
            <span className="text-slate-700">|</span>
            <BulkBtn
              icon={PenLine}
              label="Answer"
              cls="border-emerald-700/60 bg-emerald-600/10 text-emerald-200 hover:bg-emerald-600/20"
              busy={bulkBusy === "answer"}
              disabled={bulkBusy != null || selected.size === 0}
              onClick={() => runBulk("answer")}
            />
            <BulkBtn
              icon={Gauge}
              label="Evaluate"
              cls="border-amber-700/60 bg-amber-600/10 text-amber-200 hover:bg-amber-600/20"
              busy={bulkBusy === "evaluate"}
              disabled={bulkBusy != null || selected.size === 0}
              onClick={() => runBulk("evaluate")}
            />
            <BulkBtn
              icon={MessageSquare}
              label="Feedback"
              cls="border-sky-700/60 bg-sky-600/10 text-sky-200 hover:bg-sky-600/20"
              busy={bulkBusy === "feedback"}
              disabled={bulkBusy != null || selected.size === 0}
              onClick={() => runBulk("feedback")}
            />
            <BulkBtn
              icon={Tags}
              label="Classify"
              cls="border-violet-700/60 bg-violet-600/10 text-violet-200 hover:bg-violet-600/20"
              busy={bulkBusy === "classify"}
              disabled={bulkBusy != null || selected.size === 0}
              onClick={() => runBulk("classify")}
            />
            <BulkBtn
              icon={Trash2}
              label="Delete"
              cls="border-red-700/60 bg-red-600/10 text-red-200 hover:bg-red-600/20"
              busy={bulkBusy === "delete"}
              disabled={bulkBusy != null || selected.size === 0}
              onClick={() => runBulk("delete")}
            />
            <div className="ml-auto flex items-center gap-2">
              <label
                className="flex items-center gap-1 text-[11px] text-slate-400"
                title="rerun even when the field is already set."
              >
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                  className="accent-amber-500"
                />
                Overwrite
              </label>
            </div>
          </div>
          {bulkNote && (
            <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-1.5 text-[11px] text-slate-300">
              {bulkNote}
            </div>
          )}
        </div>
      )}
      {view === "list" && selected.size === 0 && bulkNote && (
        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-1.5 text-[11px] text-slate-300">
          {bulkNote}
        </div>
      )}

      {/* ── body ── */}
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center">
          <Sparkles className="mx-auto mb-3 h-8 w-8 text-slate-600" />
          <div className="text-sm text-slate-300">
            {questions.length === 0 ? "No questions yet" : "Nothing matches the filters"}
          </div>
          {questions.length === 0 && (
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
              Generate questions from extracted materials — they land here as drafts you can review.
            </p>
          )}
        </div>
      ) : view === "distribution" ? (
        <DistributionView
          questions={visible}
          onClassifyAll={runClassify}
          classifying={classifying != null}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-800">
          <label className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/70 px-3 py-2 text-[11px] text-slate-400">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              ref={(el) => {
                if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
              }}
              onChange={(e) => toggleMany(visibleIds, e.target.checked)}
              className="accent-violet-500"
            />
            Select all visible
            <span className="text-slate-600">·</span>
            <span className="text-slate-500">{visible.length}</span>
          </label>
          {chapterGroups.map((chap) => {
            const chapKey = `ch:${chap.key}`;
            const chapOpen = !collapsed.has(chapKey);
            const chapIds = chap.cats.flatMap((c) => c.questions.map((q) => q.id));
            const chapAllOn = chapIds.length > 0 && chapIds.every((id) => selected.has(id));
            const chapSomeOn = !chapAllOn && chapIds.some((id) => selected.has(id));
            const onRowDelete = (id: string) => async () => {
              await deleteQuestion(id);
              setQuestions((qs) => qs.filter((x) => x.id !== id));
              setSelected((s) => {
                if (!s.has(id)) return s;
                const n = new Set(s);
                n.delete(id);
                return n;
              });
            };
            const dimRowIcons = selected.size > 0;
            return (
              <div key={chap.key}>
                <div className="flex w-full items-center gap-2 border-b border-slate-800/70 bg-slate-900 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={chapAllOn}
                    ref={(el) => {
                      if (el) el.indeterminate = chapSomeOn;
                    }}
                    onChange={(e) => toggleMany(chapIds, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                    className="accent-violet-500"
                    title={`Select all ${chap.total} in ${chap.label}`}
                  />
                  <button
                    onClick={() => toggleGroup(chapKey)}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    <ChevronRight
                      className={`h-4 w-4 text-slate-500 transition-transform ${
                        chapOpen ? "rotate-90" : ""
                      }`}
                    />
                    <BookOpen className="h-3.5 w-3.5 text-slate-500" />
                    <span className="text-sm font-semibold text-slate-100">{chap.label}</span>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                      {chap.total}
                    </span>
                  </button>
                </div>
                {chapOpen &&
                  chap.cats.map(({ name: cat, questions: items }) => {
                    const catKey = `cat:${chap.key}/${cat}`;
                    const catOpen = !collapsed.has(catKey);
                    const reference = items.filter((q) => q.origin === "harvested");
                    const generated = items.filter((q) => q.origin !== "harvested");
                    const groupIds = items.map((q) => q.id);
                    const groupAllOn = groupIds.length > 0 && groupIds.every((id) => selected.has(id));
                    const groupSomeOn = !groupAllOn && groupIds.some((id) => selected.has(id));
                    return (
                      <div key={catKey}>
                        <div className="flex w-full items-center gap-2 border-b border-slate-800/60 bg-slate-900/40 py-1.5 pl-8 pr-3 hover:bg-slate-900/70">
                          <input
                            type="checkbox"
                            checked={groupAllOn}
                            ref={(el) => {
                              if (el) el.indeterminate = groupSomeOn;
                            }}
                            onChange={(e) => toggleMany(groupIds, e.target.checked)}
                            onClick={(e) => e.stopPropagation()}
                            className="accent-violet-500"
                            title={`Select all ${items.length} in ${cat}`}
                          />
                          <button
                            onClick={() => toggleGroup(catKey)}
                            className="flex flex-1 items-center gap-2 text-left"
                          >
                            <ChevronRight
                              className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                                catOpen ? "rotate-90" : ""
                              }`}
                            />
                            <span className="text-xs font-medium text-slate-300">{cat}</span>
                            <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                              {items.length}
                            </span>
                          </button>
                        </div>
                        {catOpen && (
                          <>
                            {reference.length > 0 && (
                              <>
                                <SubSectionHeader
                                  icon={<BookOpen className="h-3 w-3 text-amber-300" />}
                                  label="Reference"
                                  caption="from materials"
                                  count={reference.length}
                                  accent="text-amber-300"
                                />
                                {reference.map((q) => (
                                  <QuestionRow
                                    key={q.id}
                                    q={q}
                                    courseId={courseId}
                                    indent
                                    selected={selected.has(q.id)}
                                    onToggleSelect={() => toggleOne(q.id)}
                                    dimIcons={dimRowIcons}
                                    onDelete={onRowDelete(q.id)}
                                  />
                                ))}
                              </>
                            )}
                            {generated.length > 0 && (
                              <>
                                <SubSectionHeader
                                  icon={<Bot className="h-3 w-3 text-blue-300" />}
                                  label="Generated"
                                  caption="AI generated"
                                  count={generated.length}
                                  accent="text-blue-300"
                                />
                                {generated.map((q) => (
                                  <QuestionRow
                                    key={q.id}
                                    q={q}
                                    courseId={courseId}
                                    indent
                                    selected={selected.has(q.id)}
                                    onToggleSelect={() => toggleOne(q.id)}
                                    dimIcons={dimRowIcons}
                                    onDelete={onRowDelete(q.id)}
                                  />
                                ))}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}

      {harvestDialog && (
        <HarvestDialog
          courseId={courseId}
          onClose={() => setHarvestDialog(false)}
          onSubmitted={(detail) => {
            setHarvestDialog(false);
            setNote(detail);
          }}
        />
      )}
    </div>
  );
}

// ─── Distribution view ────────────────────────────────────────────────────────

function ChartCard({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {title}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-[10px] text-slate-500">{subtitle}</div>
          )}
        </div>
        {right}
      </div>
      <div className="h-64">{children}</div>
    </div>
  );
}

type TreeMapDatum = { name: string; value?: number; children?: TreeMapDatum[] };

const CATEGORY_TOP = 12;

function DistributionView({
  questions,
  onClassifyAll,
  classifying,
}: {
  questions: Question[];
  onClassifyAll: () => void | Promise<void>;
  classifying: boolean;
}) {
  const [categoryView, setCategoryView] = useState<"bar" | "tree">("bar");

  const categorySorted = useMemo(() => {
    const map = new Map<string, number>();
    for (const q of questions) {
      const cat = q.category?.trim() || UNCATEGORIZED;
      map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({ category, count }));
  }, [questions]);

  const categoryBarData = useMemo(() => {
    if (categorySorted.length <= CATEGORY_TOP) return categorySorted;
    const top = categorySorted.slice(0, CATEGORY_TOP);
    const rest = categorySorted.slice(CATEGORY_TOP);
    const otherTotal = rest.reduce((sum, d) => sum + d.count, 0);
    return [...top, { category: `Other (${rest.length})`, count: otherTotal }];
  }, [categorySorted]);

  const categoryTreeData = useMemo<TreeMapDatum>(
    () => ({
      name: "categories",
      children: categorySorted.map((d) => ({ name: d.category, value: d.count })),
    }),
    [categorySorted],
  );

  const difficultyData = useMemo(
    () =>
      [1, 2, 3, 4, 5].map((d) => ({
        difficulty: `D${d}`,
        count: questions.filter((q) => q.difficulty === d).length,
      })),
    [questions],
  );

  const difficultyStats = useMemo(() => {
    const rated = questions.filter(
      (q): q is Question & { difficulty: number } => typeof q.difficulty === "number",
    );
    if (rated.length === 0) return { avg: null as number | null, total: questions.length, rated: 0 };
    const sum = rated.reduce((s, q) => s + q.difficulty, 0);
    return { avg: sum / rated.length, total: questions.length, rated: rated.length };
  }, [questions]);

  const originSplit = useMemo(() => {
    let ai = 0;
    let harvested = 0;
    for (const q of questions) {
      if (q.origin === "harvested") harvested += 1;
      else ai += 1;
    }
    return { ai, harvested };
  }, [questions]);

  const originTotal = originSplit.ai + originSplit.harvested;
  const originData = useMemo(() => {
    if (originTotal === 0) return [] as { id: string; label: string; value: number }[];
    return [
      { id: "AI generated", label: "AI generated", value: originSplit.ai },
      { id: "Reference", label: "Reference", value: originSplit.harvested },
    ].filter((d) => d.value > 0);
  }, [originSplit, originTotal]);

  const bloomCounts = useMemo(() => {
    const counts: Record<string, number> = { unspecified: 0 };
    for (const b of BLOOMS) counts[b] = 0;
    for (const q of questions) {
      if (q.bloom && counts[q.bloom] != null) counts[q.bloom] += 1;
      else counts.unspecified += 1;
    }
    return counts;
  }, [questions]);

  const bloomData = useMemo(
    () => BLOOMS.map((b) => ({ bloom: b, count: bloomCounts[b] })),
    [bloomCounts],
  );

  const bloomNeedsClassify = useMemo(() => {
    const specified = BLOOMS.reduce((s, b) => s + bloomCounts[b], 0);
    return bloomCounts.unspecified > specified;
  }, [bloomCounts]);

  const total = questions.length;
  const ready = questions.filter((q) => q.status === "ready" || q.status === "in_exam").length;

  const segCls = (active: boolean) =>
    `px-2.5 py-1 text-[11px] font-medium transition-colors ${
      active ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
    }`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total" value={total} accent="text-slate-100" />
        <Kpi label="Ready" value={ready} accent="text-emerald-300" />
        <Kpi label="AI" value={originSplit.ai} accent="text-blue-300" />
        <Kpi label="Reference" value={originSplit.harvested} accent="text-amber-300" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Questions per category"
          subtitle={
            categorySorted.length > CATEGORY_TOP
              ? `top ${CATEGORY_TOP} of ${categorySorted.length}`
              : `${categorySorted.length} categor${categorySorted.length === 1 ? "y" : "ies"}`
          }
          right={
            <div className="inline-flex overflow-hidden rounded-md border border-slate-700">
              <button onClick={() => setCategoryView("bar")} className={segCls(categoryView === "bar")}>
                Top {CATEGORY_TOP}
              </button>
              <button
                onClick={() => setCategoryView("tree")}
                className={segCls(categoryView === "tree")}
              >
                All
              </button>
            </div>
          }
        >
          {categorySorted.length === 0 ? (
            <EmptyChart />
          ) : categoryView === "bar" ? (
            <ResponsiveBar
              data={categoryBarData}
              keys={["count"]}
              indexBy="category"
              layout="horizontal"
              theme={nivoTheme}
              colors={[CHART_COLORS[0]]}
              margin={{ top: 8, right: 24, bottom: 24, left: 140 }}
              padding={0.25}
              axisBottom={{ tickValues: 5 }}
              enableGridX
              enableGridY={false}
              enableLabel={false}
              tooltip={({ indexValue, value }) => (
                <Tip label={String(indexValue)} value={value} />
              )}
            />
          ) : (
            <ResponsiveTreeMap
              data={categoryTreeData}
              identity="name"
              value="value"
              valueFormat=".0f"
              theme={nivoTheme}
              colors={CHART_COLORS}
              innerPadding={2}
              outerPadding={2}
              labelSkipSize={18}
              label={(node) => String(node.id)}
              labelTextColor="#e2e8f0"
              borderColor={{ from: "color", modifiers: [["darker", 0.6]] }}
              nodeOpacity={0.85}
              tooltip={({ node }) => (
                <Tip label={String(node.id)} value={Number(node.value ?? 0)} />
              )}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Difficulty histogram"
          subtitle={
            difficultyStats.avg != null
              ? `avg D ${difficultyStats.avg.toFixed(1)} · ${difficultyStats.rated}/${difficultyStats.total} rated`
              : `${difficultyStats.total} total · none rated`
          }
        >
          <ResponsiveBar
            data={difficultyData}
            keys={["count"]}
            indexBy="difficulty"
            theme={nivoTheme}
            colors={[CHART_COLORS[2]]}
            margin={{ top: 8, right: 12, bottom: 32, left: 36 }}
            padding={0.35}
            enableGridY
            enableLabel={false}
            tooltip={({ indexValue, value }) => (
              <Tip label={String(indexValue)} value={value} />
            )}
          />
        </ChartCard>

        <ChartCard title="Reference vs AI-generated">
          {originData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsivePie
              data={originData}
              theme={nivoTheme}
              colors={[CHART_COLORS[0], CHART_COLORS[2]]}
              margin={{ top: 16, right: 16, bottom: 16, left: 16 }}
              innerRadius={0.55}
              padAngle={1}
              cornerRadius={3}
              borderWidth={1}
              borderColor={{ from: "color", modifiers: [["darker", 0.4]] }}
              arcLabel={(d) =>
                originTotal > 0
                  ? `${d.value} · ${Math.round((Number(d.value) / originTotal) * 100)}%`
                  : `${d.value}`
              }
              arcLabelsTextColor="#e2e8f0"
              arcLabelsSkipAngle={12}
              arcLinkLabel={(d) => String(d.id)}
              arcLinkLabelsColor={{ from: "color" }}
              arcLinkLabelsTextColor="#94a3b8"
              arcLinkLabelsSkipAngle={8}
              tooltip={({ datum }) => (
                <Tip
                  label={String(datum.id)}
                  value={Number(datum.value)}
                />
              )}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Bloom's level coverage"
          subtitle={
            bloomNeedsClassify
              ? `${bloomCounts.unspecified} unspecified`
              : `${total - bloomCounts.unspecified}/${total} classified`
          }
        >
          {bloomNeedsClassify ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Tags className="h-7 w-7 text-violet-400" />
              <div className="text-sm font-medium text-slate-100">
                {bloomCounts.unspecified} question{bloomCounts.unspecified === 1 ? "" : "s"} need classification
              </div>
              <p className="max-w-xs text-xs text-slate-500">
                Bloom levels are missing. Classify to populate this chart and unlock category-aware exam planning.
              </p>
              <button
                onClick={() => onClassifyAll()}
                disabled={classifying}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50"
              >
                {classifying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Tags className="h-3.5 w-3.5" />
                )}
                Classify all
              </button>
            </div>
          ) : (
            <ResponsiveRadar
              data={bloomData}
              keys={["count"]}
              indexBy="bloom"
              theme={nivoTheme}
              colors={[CHART_COLORS[3]]}
              margin={{ top: 32, right: 48, bottom: 32, left: 48 }}
              gridLabelOffset={12}
              dotSize={6}
              dotBorderWidth={1}
              fillOpacity={0.18}
              borderWidth={2}
            />
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 text-2xl font-semibold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function Tip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200">
      <span className="text-slate-400">{label}: </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center text-xs text-slate-600">
      No data
    </div>
  );
}

function SubSectionHeader({
  icon,
  label,
  caption,
  count,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  caption: string;
  count: number;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-800/70 bg-slate-950/60 px-4 py-1.5">
      {icon}
      <span className={`text-[11px] font-semibold uppercase tracking-wide ${accent}`}>
        {label}
      </span>
      <span className="text-[10px] text-slate-500">{caption}</span>
      <span className="ml-auto rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
        {count}
      </span>
    </div>
  );
}

function HarvestDialog({
  courseId,
  onClose,
  onSubmitted,
}: {
  courseId: string;
  onClose: () => void;
  onSubmitted: (detail: string) => void;
}) {
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listMaterials(courseId)
      .then((all) => {
        if (!active) return;
        const eligible = all.filter(
          (m) =>
            (m.collection === "exams" || m.collection === "exercises") &&
            m.extraction_status === "done",
        );
        setMaterials(eligible);
        setPicked(new Set(eligible.map((m) => m.id)));
      })
      .catch((e) => {
        if (active) setLoadErr(e instanceof ApiError ? e.message : "failed to load materials");
      });
    return () => {
      active = false;
    };
  }, [courseId]);

  function toggle(id: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function submit() {
    if (picked.size === 0) {
      setErr("Select at least one material.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await harvestQuestions([...picked]);
      onSubmitted(
        `Harvesting from ${picked.size} material(s)… Resync once it finishes to see reference questions.`,
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "harvest failed to start");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
            <Scissors className="h-4 w-4 text-amber-300" />
            Harvest reference questions
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Pull existing questions from past exams and exercise sheets into the bank as reference
          material.
        </p>

        <div className="space-y-4">
          {loadErr ? (
            <div className="rounded-lg border border-red-700/50 bg-red-500/5 px-3 py-2 text-xs text-red-300">
              {loadErr}
            </div>
          ) : materials === null ? (
            <div className="flex items-center gap-2 px-1 py-3 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading materials…
            </div>
          ) : materials.length === 0 ? (
            <div className="rounded-lg border border-amber-700/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
              No extracted exam or exercise materials. Add and extract exams or exercise sheets
              first.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-300">
                Materials ({picked.size} of {materials.length} selected)
              </label>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-2">
                {materials.map((m) => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800/60"
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(m.id)}
                      onChange={() => toggle(m.id)}
                      className="accent-amber-500"
                    />
                    <span className="truncate">{m.title || m.original_filename}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-slate-500">
                      {m.collection}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {err && <div className="text-xs text-red-400">{err}</div>}

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy || !materials || materials.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Scissors className="h-3.5 w-3.5" />
              )}
              Harvest
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuestionRow({
  q,
  courseId,
  onDelete,
  selected,
  onToggleSelect,
  indent,
  dimIcons,
}: {
  q: Question;
  courseId: string;
  onDelete: () => Promise<void>;
  selected: boolean;
  onToggleSelect: () => void;
  indent?: boolean;
  dimIcons?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [feedbacking, setFeedbacking] = useState(false);
  const kind = KIND[q.kind] ?? { label: q.kind, short: q.kind, cls: "bg-slate-700 text-slate-200" };
  const harvested = q.origin === "harvested";
  const hasFigures = questionHasFigures(q);
  const topics = q.topics.slice(0, 2);
  const preview = useMemo(() => rewriteFigures(promptPreview(q.prompt_md), q.id), [q.prompt_md, q.id]);
  const iconCls = dimIcons ? "opacity-50 hover:opacity-100" : "";

  function handleCheckboxClick(e: React.MouseEvent) {
    e.stopPropagation();
  }
  function handleCheckboxChange(e: React.ChangeEvent<HTMLInputElement>) {
    e.stopPropagation();
    onToggleSelect();
  }

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
    }
  }

  async function handleAnswer(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setAnswering(true);
    try {
      await answerQuestion(q.id);
    } finally {
      setAnswering(false);
    }
  }

  async function handleEvaluate(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setEvaluating(true);
    try {
      await evaluateQuestion(q.id);
    } finally {
      setEvaluating(false);
    }
  }

  async function handleFeedback(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setFeedbacking(true);
    try {
      await feedbackQuestion(q.id);
    } finally {
      setFeedbacking(false);
    }
  }

  return (
    <Link
      href={`/courses/${courseId}/questions/${q.id}`}
      className={`grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 border-b border-slate-800/70 py-2.5 text-xs last:border-b-0 hover:bg-slate-900/60 ${
        selected ? "bg-violet-500/5" : ""
      } ${indent ? "pl-6 pr-4" : "px-4"}`}
    >
      {/* selection checkbox */}
      <span
        className="flex h-4 w-4 items-center justify-center"
        onClick={handleCheckboxClick}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={handleCheckboxChange}
          onClick={handleCheckboxClick}
          className="accent-violet-500"
          aria-label="Select question"
        />
      </span>
      {/* meta column */}
      <div className="flex w-44 shrink-0 flex-wrap items-center gap-1.5">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${kind.cls}`}>
          {kind.short}
        </span>
        <span className="font-mono text-[11px] text-slate-400">D{q.difficulty ?? "—"}</span>
        {q.bloom && (
          <span className={`text-[11px] ${BLOOM[q.bloom] ?? "text-slate-400"}`}>{q.bloom}</span>
        )}
      </div>

      {/* prompt + chips */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-500">
            {q.status}
          </span>
          {topics.map((t) => (
            <span
              key={t}
              className="rounded bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-400"
            >
              {t}
            </span>
          ))}
          {hasFigures && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
              <ImageIcon className="h-3 w-3" />
            </span>
          )}
          {q.scope_alignment != null && q.scope_alignment < 6 && (
            <span
              title={q.off_topic_reason ?? "Scope alignment below 6/10"}
              className="rounded bg-amber-600/15 px-1.5 py-0.5 text-[10px] text-amber-300"
            >
              off-topic {q.scope_alignment.toFixed(0)}/10
            </span>
          )}
          {q.reference_deviation != null && q.origin !== "harvested" && (
            <span
              title={q.reference_match_note ?? "Deviation from harvested reference set"}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                q.reference_deviation < 3
                  ? "bg-emerald-600/15 text-emerald-300"
                  : q.reference_deviation < 6
                  ? "bg-slate-700 text-slate-300"
                  : "bg-red-600/15 text-red-300"
              }`}
            >
              ref Δ {q.reference_deviation.toFixed(1)}
            </span>
          )}
        </div>
        <div className="mt-0.5 max-h-[3em] overflow-hidden text-sm leading-[1.5em] text-slate-200 [&_*]:!my-0 [&_p]:!leading-[1.5em] [&_pre]:!py-0 [&_pre]:!px-2 [&_code]:!text-xs [&_blockquote]:!py-0">
          <MarkdownRenderer markdown={preview} />
        </div>
      </div>

      {/* score + origin + actions */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Status pills — one chip per AI pass with present/absent state. */}
        <div className="flex items-center gap-0.5">
          <StatusPill
            letter="A"
            done={!!q.answer_md?.trim() || !!q.worked_solution_md?.trim()}
            color="emerald"
            tip={
              q.answer_md?.trim() || q.worked_solution_md?.trim()
                ? "Answer ready"
                : "No answer yet — run Answer"
            }
          />
          <StatusPill
            letter="E"
            done={q.eval_correctness != null}
            color="amber"
            tip={
              q.eval_correctness != null
                ? `Evaluated · correctness ${q.eval_correctness}/10`
                : "Not evaluated — run Evaluate"
            }
          />
          <StatusPill
            letter="F"
            done={!!q.feedback_md?.trim()}
            color="sky"
            tip={q.feedback_md?.trim() ? "Feedback critique present" : "No feedback yet — run Feedback"}
          />
          {q.origin !== "harvested" && (
            <StatusPill
              letter="R"
              done={q.reference_deviation != null}
              color="violet"
              tip={
                q.reference_deviation != null
                  ? `Reference match · deviation ${q.reference_deviation.toFixed(1)}/10`
                  : "Not compared to reference — run Reference match"
              }
            />
          )}
        </div>
        {q.eval_correctness != null && (
          <span className={`flex items-center gap-1 text-[11px] ${scoreColor(q.eval_correctness)}`}>
            <CheckCircle2 className="h-3 w-3" />
            {q.eval_correctness}/10
          </span>
        )}
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
            harvested ? "bg-amber-600/20 text-amber-300" : "bg-blue-600/20 text-blue-300"
          }`}
          title={harvested ? "Harvested from existing material" : "AI generated"}
        >
          {harvested ? <BookOpen className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
          {harvested ? "Reference" : "AI"}
        </span>
        <button
          onClick={handleAnswer}
          disabled={answering}
          className={`text-slate-600 hover:text-emerald-400 disabled:opacity-50 ${iconCls}`}
          title="Generate answer key"
        >
          {answering ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PenLine className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={handleEvaluate}
          disabled={evaluating}
          className={`text-slate-600 hover:text-amber-400 disabled:opacity-50 ${iconCls}`}
          title="Evaluate question"
        >
          {evaluating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Gauge className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={handleFeedback}
          disabled={feedbacking}
          className={`text-slate-600 hover:text-sky-400 disabled:opacity-50 ${iconCls}`}
          title="Run feedback pass"
        >
          {feedbacking ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageSquare className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={handleDelete}
          disabled={busy}
          className={`text-slate-600 hover:text-red-400 disabled:opacity-50 ${iconCls}`}
          title="Delete question"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    </Link>
  );
}

function BulkBtn({
  icon: I,
  label,
  cls,
  busy,
  disabled,
  onClick,
}: {
  icon: typeof PenLine;
  label: string;
  cls: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <I className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

const STATUS_PILL_DONE: Record<string, string> = {
  emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-600/40",
  amber: "bg-amber-500/15 text-amber-300 border-amber-600/40",
  sky: "bg-sky-500/15 text-sky-300 border-sky-600/40",
  violet: "bg-violet-500/15 text-violet-300 border-violet-600/40",
};

function StatusPill({
  letter,
  done,
  color,
  tip,
}: {
  letter: string;
  done: boolean;
  color: keyof typeof STATUS_PILL_DONE;
  tip: string;
}) {
  const cls = done
    ? STATUS_PILL_DONE[color]
    : "bg-slate-900 text-slate-600 border-slate-800";
  return (
    <span
      title={tip}
      className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[9px] font-bold ${cls}`}
    >
      {letter}
    </span>
  );
}
