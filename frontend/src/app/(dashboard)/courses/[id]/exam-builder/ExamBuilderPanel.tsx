"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  RefreshCw,
  Plus,
  X,
  Sparkles,
  Wand2,
  Hammer,
  Save,
  FileText,
  FileDown,
  ExternalLink,
  Eye,
  BookOpen,
  Bot,
} from "lucide-react";

import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { QuestionDetailModal } from "@/components/QuestionDetailModal";

import {
  ApiError,
  buildAutoExams,
  compileExam,
  createExam,
  examFileUrl,
  getExam,
  getExamPlan,
  listQuestions,
  questionFigureUrl,
  renderExam,
  setExamQuestions,
  type ExamDetail,
  type ExamPlanCategory,
  type Question,
} from "@/lib/api";

const FIGURE_RE = /\]\(figures\/(?:[^/]+\/)?([^)\s]+\.png)\)/g;

function rewriteFiguresFor(q: Question): string {
  return (q.prompt_md ?? "").replace(
    FIGURE_RE,
    (_m, name: string) => `](${questionFigureUrl(q.id, name)})`,
  );
}

type Mode = "auto" | "manual";

const selectCls =
  "rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none";

const numCls =
  "w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none";

function promptPreview(md: string): string {
  return md
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\*)\*(?!\*)([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "[figure]")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\$\$([^$]+)\$\$/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/\\([a-zA-Z]+)\{([^}]+)\}/g, "$2")
    .replace(/\\([a-zA-Z]+)/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type AutoSlot = { category: string; difficulty: string; points: number };
type ManualSlot = {
  question_id: string;
  points: number;
  position: number;
  // Per-slot pool filters — every row narrows its own dropdown
  // independently so flipping one slot's chapter doesn't blow away the
  // others' selections.
  fChapter: string;
  fCategory: string;
  fOrigin: "harvested" | "ai-generated";
};

export function ExamBuilderPanel({ courseId }: { courseId: string }) {
  const [mode, setMode] = useState<Mode>("auto");
  const [categories, setCategories] = useState<ExamPlanCategory[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [resyncing, setResyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [plan, qs] = await Promise.all([
        getExamPlan(courseId),
        listQuestions(courseId),
      ]);
      setCategories(plan.categories);
      setQuestions(qs);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "failed to load exam builder data");
    }
  }, [courseId]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const resync = useCallback(async () => {
    setResyncing(true);
    await load();
    setResyncing(false);
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading exam builder…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
          <button
            onClick={() => setMode("auto")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${
              mode === "auto"
                ? "bg-blue-500 text-white"
                : "bg-slate-950 text-slate-300 hover:bg-slate-900"
            }`}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Auto
          </button>
          <button
            onClick={() => setMode("manual")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${
              mode === "manual"
                ? "bg-blue-500 text-white"
                : "bg-slate-950 text-slate-300 hover:bg-slate-900"
            }`}
          >
            <Hammer className="h-3.5 w-3.5" />
            Manual
          </button>
        </div>

        <div className="flex-1" />

        <button
          onClick={resync}
          disabled={resyncing}
          title="Resync — re-fetch categories and questions"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-50"
        >
          {resyncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Resync
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-red-700/50 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}

      {mode === "auto" ? (
        <AutoBuilder courseId={courseId} categories={categories} />
      ) : (
        <ManualBuilder
          courseId={courseId}
          questions={questions}
          categories={categories}
          onQuestionUpdated={(updated) =>
            setQuestions((qs) => qs.map((q) => (q.id === updated.id ? updated : q)))
          }
        />
      )}
    </div>
  );
}

// ─── Auto mode ────────────────────────────────────────────────────────────────

function AutoBuilder({
  courseId,
  categories,
}: {
  courseId: string;
  categories: ExamPlanCategory[];
}) {
  // The stored plan carries far more categories than the bank has questions for —
  // on this course, 88 of 126 are empty. Listing them in plan order put an empty
  // category at the top of the dropdown and seeded every new slot with it, so the
  // obvious first action produced an exam with no questions. Usable ones come first.
  const ranked = useMemo(
    () =>
      [...categories].sort(
        (a, b) => b.have - a.have || a.name.localeCompare(b.name),
      ),
    [categories],
  );
  const [title, setTitle] = useState("");
  const [totalMinutes, setTotalMinutes] = useState(120);
  const [variants, setVariants] = useState(2);
  const [slots, setSlots] = useState<AutoSlot[]>([
    { category: ranked[0]?.name ?? "", difficulty: "", points: 10 },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [builtIds, setBuiltIds] = useState<string[]>([]);

  function updateSlot(idx: number, patch: Partial<AutoSlot>) {
    setSlots((s) => s.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  function addSlot() {
    // Default to the next category that actually has questions, so a five-slot
    // blueprint does not silently fill with empty categories.
    setSlots((s) => {
      const used = new Set(s.map((row) => row.category));
      const next = ranked.find((c) => c.have > 0 && !used.has(c.name)) ?? ranked[0];
      return [...s, { category: next?.name ?? "", difficulty: "", points: 10 }];
    });
  }

  function removeSlot(idx: number) {
    setSlots((s) => s.filter((_, i) => i !== idx));
  }

  async function build() {
    if (!title.trim()) {
      setErr("Give the exam a title.");
      return;
    }
    const usable = slots.filter((s) => s.category.trim());
    if (usable.length === 0) {
      setErr("Add at least one slot with a category.");
      return;
    }
    setBusy(true);
    setErr(null);
    setBuiltIds([]);
    try {
      const r = await buildAutoExams({
        course_id: courseId,
        title: title.trim(),
        total_minutes: totalMinutes,
        variants,
        slots: usable.map((s) => ({
          category: s.category.trim(),
          difficulty: s.difficulty ? Number(s.difficulty) : null,
          points: s.points,
        })),
      });
      setBuiltIds(r.exam_ids);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "auto build failed");
    } finally {
      setBusy(false);
    }
  }

  const totalPoints = slots.reduce((sum, s) => sum + (s.points || 0), 0);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40">
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
          <Wand2 className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-200">Auto blueprint</h2>
          <span className="text-xs text-slate-500">
            — AIEA picks questions per slot for each variant
          </span>
        </div>

        <div className="grid gap-3 border-b border-slate-800 px-4 py-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1 sm:col-span-3">
            <label className="text-xs font-medium text-slate-300">Exam title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Midterm — Spring 2026"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-300">Total minutes</label>
            <input
              type="number"
              min={1}
              value={totalMinutes}
              onChange={(e) =>
                setTotalMinutes(Math.max(1, Number(e.target.value) || 1))
              }
              className={selectCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-300">Variants</label>
            <input
              type="number"
              min={1}
              max={20}
              value={variants}
              onChange={(e) =>
                setVariants(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
              }
              className={selectCls}
            />
          </div>
        </div>

        {categories.length === 0 && (
          <div className="border-b border-slate-800 px-4 py-3">
            <div className="rounded-lg border border-amber-700/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
              No categories in the exam plan yet — define categories on the Exam Plan
              page so slots can target them.
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Difficulty</th>
                <th className="px-4 py-2 font-medium">Points</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {slots.map((slot, idx) => (
                <tr key={idx} className="border-t border-slate-800">
                  <td className="px-4 py-2.5">
                    <select
                      className={`${selectCls} w-full`}
                      value={slot.category}
                      onChange={(e) => updateSlot(idx, { category: e.target.value })}
                    >
                      <option value="">— pick a category —</option>
                      {ranked.map((c, i) => (
                        <option
                          key={`${c.chapter_id ?? "_"}::${c.name}::${i}`}
                          value={c.name}
                          disabled={c.have === 0}
                        >
                          {c.chapter_id ? `${c.chapter_id} · ` : ""}
                          {c.name} ({c.have} available)
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      className={selectCls}
                      value={slot.difficulty}
                      onChange={(e) => updateSlot(idx, { difficulty: e.target.value })}
                    >
                      <option value="">any</option>
                      {[1, 2, 3, 4, 5].map((d) => (
                        <option key={d} value={d}>
                          {d} / 5
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="number"
                      min={0}
                      value={slot.points}
                      onChange={(e) =>
                        updateSlot(idx, {
                          points: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className={numCls}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => removeSlot(idx)}
                      className="text-slate-600 hover:text-red-400"
                      title="Remove slot"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-800 px-4 py-3">
          <button
            onClick={addSlot}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600"
          >
            <Plus className="h-3.5 w-3.5" />
            slot
          </button>
          <span className="text-xs text-slate-500">
            {slots.length} slot{slots.length === 1 ? "" : "s"} · {totalPoints} pts
          </span>
          <div className="flex-1" />
          <button
            onClick={build}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Build {variants} variant{variants === 1 ? "" : "s"}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-700/50 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}

      {builtIds.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-2 text-sm font-medium text-slate-200">
            {builtIds.length} exam{builtIds.length === 1 ? "" : "s"} created
          </div>
          <div className="flex flex-wrap gap-2">
            {builtIds.map((id, i) => (
              <Link
                key={id}
                href={`/courses/${courseId}/exam-bank`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600"
              >
                <FileText className="h-3.5 w-3.5" />
                Variant {i + 1}
                <ExternalLink className="h-3 w-3 text-slate-500" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Manual mode ──────────────────────────────────────────────────────────────

function ManualBuilder({
  courseId,
  questions,
  categories,
  onQuestionUpdated,
}: {
  courseId: string;
  questions: Question[];
  categories: ExamPlanCategory[];
  onQuestionUpdated: (q: Question) => void;
}) {
  const [title, setTitle] = useState("");
  const [totalMinutes, setTotalMinutes] = useState(120);
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [slots, setSlots] = useState<ManualSlot[]>([]);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [previewQid, setPreviewQid] = useState<string | null>(null);

  const questionsById = useMemo(() => {
    const map = new Map<string, Question>();
    for (const q of questions) map.set(q.id, q);
    return map;
  }, [questions]);

  // Chapter list and per-chapter categories derived from the question pool.
  const chapterOptions = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const q of questions) {
      const ch = (q.chapter_id ?? "").trim() || "(unassigned)";
      const cat = (q.category ?? "").trim() || "(uncategorized)";
      if (!map.has(ch)) map.set(ch, new Set());
      map.get(ch)!.add(cat);
    }
    return [...map.entries()]
      .map(([ch, cats]) => ({ ch, cats: [...cats].sort() }))
      .sort((a, b) => a.ch.localeCompare(b.ch));
  }, [questions]);

  function poolForSlot(slot: ManualSlot): Question[] {
    return questions.filter((q) => {
      if (q.origin !== slot.fOrigin) return false;
      if (slot.fChapter) {
        const qch = (q.chapter_id ?? "").trim() || "(unassigned)";
        if (qch !== slot.fChapter) return false;
      }
      if (slot.fCategory) {
        const qcat = (q.category ?? "").trim() || "(uncategorized)";
        if (qcat !== slot.fCategory) return false;
      }
      return true;
    });
  }

  async function create() {
    if (!title.trim()) {
      setErr("Give the exam a title.");
      return;
    }
    setCreating(true);
    setErr(null);
    setNote(null);
    try {
      const summary = await createExam({
        course_id: courseId,
        title: title.trim(),
        total_minutes: totalMinutes,
      });
      const detail = await getExam(summary.id);
      setExam(detail);
      setSlots(
        detail.questions.map((q) => {
          const ref = questionsById.get(q.question_id);
          return {
            question_id: q.question_id,
            points: q.points,
            position: q.position,
            fChapter: ref?.chapter_id ?? "",
            fCategory: ref?.category ?? "",
            fOrigin: (ref?.origin === "harvested" ? "harvested" : "ai-generated"),
          };
        }),
      );
      setNote("Exam created — add questions, then save.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "could not create exam");
    } finally {
      setCreating(false);
    }
  }

  function updateSlot(idx: number, patch: Partial<ManualSlot>) {
    setSlots((s) => s.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  function addSlot() {
    setSlots((s) => [
      ...s,
      {
        question_id: "",
        points: 10,
        position: s.length + 1,
        fChapter: "",
        fCategory: "",
        fOrigin: "ai-generated",
      },
    ]);
  }

  function removeSlot(idx: number) {
    setSlots((s) =>
      s
        .filter((_, i) => i !== idx)
        .map((row, i) => ({ ...row, position: i + 1 })),
    );
  }

  async function save() {
    if (!exam) return;
    const usable = slots.filter((s) => s.question_id);
    if (usable.length === 0) {
      setErr("Pick at least one question.");
      return;
    }
    setSaving(true);
    setErr(null);
    setNote(null);
    try {
      const detail = await setExamQuestions(
        exam.id,
        usable.map((s) => {
          const q = questionsById.get(s.question_id);
          return {
            question_id: s.question_id,
            position: s.position,
            points: s.points,
            category: q?.category ?? null,
          };
        }),
      );
      setExam(detail);
      setNote(`Saved — ${detail.questions.length} question(s).`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function doRender() {
    if (!exam) return;
    setRendering(true);
    setErr(null);
    setNote(null);
    try {
      await renderExam(exam.id);
      setExam(await getExam(exam.id));
      setNote("Rendered .tex.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "render failed");
    } finally {
      setRendering(false);
    }
  }

  async function doCompile() {
    if (!exam) return;
    setCompiling(true);
    setErr(null);
    setNote(null);
    try {
      await compileExam(exam.id);
      setExam(await getExam(exam.id));
      setNote("Compiled .pdf.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "compile failed");
    } finally {
      setCompiling(false);
    }
  }

  const totalPoints = slots.reduce((sum, s) => sum + (s.points || 0), 0);

  return (
    <div className="space-y-4">
      {!exam ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40">
          <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
            <Hammer className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-200">New exam</h2>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
              Step 1 of 2 — name &amp; minutes
            </span>
            <div className="flex-1" />
            <span className="text-[11px] text-slate-500">
              Step 2 (after Create): add questions, set points, render &amp; compile
            </span>
          </div>
          <div className="grid gap-3 px-4 py-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs font-medium text-slate-300">Exam title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Final Exam — Spring 2026"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-300">Total minutes</label>
              <input
                type="number"
                min={1}
                value={totalMinutes}
                onChange={(e) =>
                  setTotalMinutes(Math.max(1, Number(e.target.value) || 1))
                }
                className={selectCls}
              />
            </div>
          </div>
          <div className="flex justify-end border-t border-slate-800 px-4 py-3">
            <button
              onClick={create}
              disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Create exam
            </button>
          </div>
          <div className="border-t border-slate-800 bg-slate-950/40 px-4 py-3">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-slate-500">
              Step 2 preview
            </div>
            <p className="text-xs text-slate-400">
              After you click <span className="text-slate-200">Create exam</span>, a
              question-picker table appears with columns:{" "}
              <span className="text-slate-300">Position · Question · Points</span>. Use{" "}
              <span className="text-slate-300">+ slot</span> to add each row, pick from
              the bank, set points, then <span className="text-slate-300">Save</span>.
              Render produces the <code>.tex</code>, Compile produces the{" "}
              <code>.pdf</code>.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-3">
            <Hammer className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-200">{exam.title}</h2>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
              {exam.status}
            </span>
            <span className="text-xs text-slate-500">{exam.total_minutes} min</span>
            <div className="flex-1" />
            <button
              onClick={addSlot}
              disabled={questions.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              slot
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </button>
            <button
              onClick={() => {
                if (
                  !confirm(
                    "Close this exam editor? Unsaved changes will be lost — open the exam from Exam Bank to keep editing later.",
                  )
                )
                  return;
                setExam(null);
                setSlots([]);
                setTitle("");
                setTotalMinutes(120);
                setNote(null);
                setErr(null);
              }}
              title="Close this exam editor"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-red-700/60 hover:text-red-300"
            >
              <X className="h-3.5 w-3.5" />
              Close
            </button>
          </div>

          {questions.length === 0 && (
            <div className="border-b border-slate-800 px-4 py-3">
              <div className="rounded-lg border border-amber-700/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
                No questions in the bank yet — generate questions first.
              </div>
            </div>
          )}

          {slots.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <FileText className="mx-auto mb-3 h-8 w-8 text-slate-600" />
              <div className="text-sm text-slate-300">No questions added</div>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
                Add a slot, then choose its chapter / category / origin to
                narrow the pool for that slot only. Each row keeps its own
                filters so changing one won&apos;t reset the others.
              </p>
            </div>
          ) : (
            <div className="space-y-3 px-4 py-3">
              {slots.map((slot, idx) => {
                const q = slot.question_id
                  ? questionsById.get(slot.question_id)
                  : undefined;
                const slotPool = poolForSlot(slot);
                const cats =
                  chapterOptions.find((c) => c.ch === slot.fChapter)?.cats ?? [];
                return (
                  <div
                    key={idx}
                    className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-400">
                        slot #{slot.position}
                      </span>
                      <input
                        type="number"
                        min={1}
                        value={slot.position}
                        onChange={(e) =>
                          updateSlot(idx, {
                            position: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                        className="w-14 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                        title="Position"
                      />
                      <div className="flex-1" />
                      <span className="text-[11px] text-slate-500">
                        Points
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={slot.points}
                        onChange={(e) =>
                          updateSlot(idx, {
                            points: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className={numCls}
                      />
                      <button
                        onClick={() => removeSlot(idx)}
                        className="text-slate-600 hover:text-red-400"
                        title="Remove slot"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Per-slot filters */}
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span className="uppercase tracking-wider text-slate-500">
                        Pool
                      </span>
                      <select
                        value={slot.fOrigin}
                        onChange={(e) =>
                          updateSlot(idx, {
                            fOrigin: e.target.value as "harvested" | "ai-generated",
                            question_id: "",
                          })
                        }
                        className={selectCls}
                      >
                        <option value="ai-generated">AI generated</option>
                        <option value="harvested">Reference (harvested)</option>
                      </select>
                      <select
                        value={slot.fChapter}
                        onChange={(e) =>
                          updateSlot(idx, {
                            fChapter: e.target.value,
                            fCategory: "",
                            question_id: "",
                          })
                        }
                        className={selectCls}
                      >
                        <option value="">all chapters</option>
                        {chapterOptions.map(({ ch }) => (
                          <option key={ch} value={ch}>
                            {ch}
                          </option>
                        ))}
                      </select>
                      <select
                        value={slot.fCategory}
                        onChange={(e) =>
                          updateSlot(idx, {
                            fCategory: e.target.value,
                            question_id: "",
                          })
                        }
                        className={selectCls}
                        disabled={!slot.fChapter}
                        title={slot.fChapter ? undefined : "Pick a chapter first"}
                      >
                        <option value="">all categories</option>
                        {cats.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                      <span className="ml-auto text-[11px] text-slate-500">
                        {slotPool.length} question{slotPool.length === 1 ? "" : "s"} in pool
                      </span>
                    </div>

                    {/* Question picker */}
                    <div className="flex items-start gap-2">
                      <select
                        className={`${selectCls} flex-1`}
                        value={slot.question_id}
                        onChange={(e) =>
                          updateSlot(idx, { question_id: e.target.value })
                        }
                      >
                        <option value="">— pick a question —</option>
                        {slotPool.map((qq) => (
                          <option key={qq.id} value={qq.id}>
                            {(qq.chapter_id ?? "—")} · {qq.category ?? "uncat"} ·{" "}
                            {qq.kind} · D{qq.difficulty ?? "—"} ·{" "}
                            {promptPreview(qq.prompt_md).slice(0, 50)}
                          </option>
                        ))}
                      </select>
                      {q && (
                        <button
                          onClick={() => setPreviewQid(q.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-300 hover:border-blue-700/60 hover:text-blue-200"
                          title="Open the question detail"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Detail
                        </button>
                      )}
                    </div>

                    {q && (
                      <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                        <div className="mb-1 flex flex-wrap items-center gap-1 text-[10px]">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${
                              q.origin === "harvested"
                                ? "bg-amber-600/20 text-amber-300"
                                : "bg-blue-600/20 text-blue-300"
                            }`}
                          >
                            {q.origin === "harvested" ? (
                              <BookOpen className="h-2.5 w-2.5" />
                            ) : (
                              <Bot className="h-2.5 w-2.5" />
                            )}
                            {q.origin === "harvested" ? "Reference" : "AI"}
                          </span>
                          {q.chapter_id && (
                            <span className="font-mono text-slate-400">
                              {q.chapter_id}
                            </span>
                          )}
                          {q.category && (
                            <span className="truncate text-slate-400" title={q.category}>
                              · {q.category}
                            </span>
                          )}
                          <span className="font-mono text-slate-400">
                            · D{q.difficulty ?? "—"}
                          </span>
                          {q.bloom && (
                            <span className="text-slate-500">· {q.bloom}</span>
                          )}
                          {q.est_minutes != null && (
                            <span className="text-slate-500">· ~{q.est_minutes} min</span>
                          )}
                        </div>
                        <div className="prose-row max-h-24 overflow-hidden text-[12px] text-slate-300">
                          <MarkdownRenderer markdown={rewriteFiguresFor(q)} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {previewQid && (
            <QuestionDetailModal
              questionId={previewQid}
              onClose={() => setPreviewQid(null)}
              onSaved={onQuestionUpdated}
            />
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-800 px-4 py-3">
            <span className="text-xs text-slate-500">
              {slots.length} question{slots.length === 1 ? "" : "s"} · {totalPoints} pts
            </span>
            <div className="flex-1" />
            <button
              onClick={doRender}
              disabled={rendering || exam.question_count === 0}
              title={
                exam.question_count === 0 ? "Save questions before rendering" : undefined
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-40"
            >
              {rendering ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              Render .tex
            </button>
            <button
              onClick={doCompile}
              disabled={compiling || exam.question_count === 0}
              title={
                exam.question_count === 0 ? "Save questions before compiling" : undefined
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-40"
            >
              {compiling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDown className="h-3.5 w-3.5" />
              )}
              Compile .pdf
            </button>
          </div>

          {(exam.tex_path || exam.pdf_path) && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 px-4 py-3">
              <span className="text-xs text-slate-500">Built files:</span>
              {exam.tex_path && (
                <a
                  href={examFileUrl(exam.id, "tex")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600"
                >
                  <FileText className="h-3.5 w-3.5" />
                  .tex
                  <ExternalLink className="h-3 w-3 text-slate-500" />
                </a>
              )}
              {exam.pdf_path && (
                <a
                  href={examFileUrl(exam.id, "pdf")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  .pdf
                  <ExternalLink className="h-3 w-3 text-slate-500" />
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {categories.length > 0 && (
        <p className="px-1 text-[11px] text-slate-600">
          Plan categories: {categories.map((c) => c.name).join(" · ")}
        </p>
      )}

      {err && (
        <div className="rounded-lg border border-red-700/50 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}
      {note && (
        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
          {note}
        </div>
      )}
    </div>
  );
}

