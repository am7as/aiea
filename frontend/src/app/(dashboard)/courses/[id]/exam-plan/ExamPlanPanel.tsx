"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  RefreshCw,
  Save,
  Plus,
  Sparkles,
  X,
  AlertTriangle,
  ClipboardList,
} from "lucide-react";

import {
  ApiError,
  getExamPlan,
  getSyllabus,
  putExamPlan,
  generateQuestions,
  listMaterials,
  type ExamPlan,
  type Material,
  type QuestionKind,
  type SyllabusChapter,
} from "@/lib/api";

const KINDS: QuestionKind[] = ["mcq", "short", "essay", "problem", "code", "true_false"];

const KIND_LABEL: Record<QuestionKind, string> = {
  mcq: "MCQ",
  short: "Short answer",
  essay: "Essay",
  problem: "Problem",
  code: "Code",
  true_false: "True / False",
};

const selectCls =
  "rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none";

const numCls =
  "w-16 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none";

type Row = {
  chapter_id: string | null;
  name: string;
  target: number;
  have: number;
};

function sortedRowIdx(rows: Row[], chapters: SyllabusChapter[]): number[] {
  const order = chapters.map((c) => (c.id ?? "").trim());
  const idxs = rows.map((_, i) => i);
  return idxs.sort((a, b) => {
    const ca = rows[a].chapter_id ?? "";
    const cb = rows[b].chapter_id ?? "";
    if (ca === "" && cb !== "") return 1;
    if (cb === "" && ca !== "") return -1;
    const ai = order.indexOf(ca);
    const bi = order.indexOf(cb);
    if (ai !== bi) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return rows[a].name.localeCompare(rows[b].name);
  });
}

type DifficultyChoice = "mixed" | "1" | "2" | "3" | "4" | "5";

type GenRequest = {
  chapter_id: string | null;
  category: string;
  count: number;
  difficulty: DifficultyChoice;
  diagrams: boolean;
};

export function ExamPlanPanel({ courseId }: { courseId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [totalQuestions, setTotalQuestions] = useState(20);
  const [totalMinutes, setTotalMinutes] = useState(120);
  const [notes, setNotes] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [chapters, setChapters] = useState<SyllabusChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [genSeed, setGenSeed] = useState<{ chapter_id: string | null; name: string }>({
    chapter_id: null,
    name: "",
  });

  const apply = useCallback((plan: ExamPlan) => {
    setTotalQuestions(plan.total_questions);
    setTotalMinutes(plan.total_minutes);
    setNotes(plan.notes ?? "");
    setRows(
      plan.categories.map((c) => ({
        chapter_id: c.chapter_id ?? null,
        name: c.name,
        target: c.target,
        have: c.have,
      })),
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [plan, mats, syll] = await Promise.all([
        getExamPlan(courseId),
        listMaterials(courseId),
        getSyllabus(courseId).catch(() => ({ chapters: [] as SyllabusChapter[] })),
      ]);
      apply(plan);
      setMaterials(mats);
      setChapters(syll.chapters ?? []);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "failed to load exam plan");
    } finally {
      setLoading(false);
    }
  }, [courseId, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const readyMaterials = materials.filter((m) => m.extraction_status === "done");

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((rs) => [...rs, { chapter_id: null, name: "", target: 1, have: 0 }]);
  }

  function removeRow(idx: number) {
    setRows((rs) => rs.filter((_, i) => i !== idx));
  }

  async function save() {
    setSaving(true);
    setErr(null);
    setNote(null);
    try {
      const plan = await putExamPlan(courseId, {
        total_questions: totalQuestions,
        total_minutes: totalMinutes,
        categories: rows
          .filter((r) => r.name.trim())
          .map((r) => ({
            chapter_id: r.chapter_id,
            name: r.name.trim(),
            target: r.target,
          })),
        notes,
      });
      apply(plan);
      setNote("Exam plan saved.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading exam plan…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-200">Exam Plan</h2>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => {
              setGenSeed({ chapter_id: null, name: "" });
              setGenOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Generate questions
          </button>
          <button
            onClick={addRow}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600"
          >
            <Plus className="h-3.5 w-3.5" />
            Category
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
            onClick={load}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-50"
            title="Resync"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-3 text-xs text-slate-400">
          <span>Target:</span>
          <input
            type="number"
            min={1}
            value={totalQuestions}
            onChange={(e) =>
              setTotalQuestions(Math.max(1, Number(e.target.value) || 1))
            }
            className={numCls}
          />
          <span>questions ·</span>
          <input
            type="number"
            min={1}
            value={totalMinutes}
            onChange={(e) =>
              setTotalMinutes(Math.max(1, Number(e.target.value) || 1))
            }
            className={numCls}
          />
          <span>min</span>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Sparkles className="mx-auto mb-3 h-8 w-8 text-slate-600" />
            <div className="text-sm text-slate-300">No categories yet</div>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
              Add a category to set a per-topic question target, or generate
              questions and AIEA will track coverage here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="w-1/4 px-4 py-2 font-medium">Chapter</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Target</th>
                  <th className="px-4 py-2 font-medium">Have</th>
                  <th className="px-4 py-2 font-medium">Gap</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {sortedRowIdx(rows, chapters).map((idx) => {
                  const row = rows[idx];
                  const gap = row.have - row.target;
                  const ok = gap >= 0;
                  return (
                    <tr key={idx} className="border-t border-slate-800">
                      <td className="px-4 py-2.5">
                        <select
                          value={row.chapter_id ?? ""}
                          onChange={(e) =>
                            updateRow(idx, { chapter_id: e.target.value || null })
                          }
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">(unassigned)</option>
                          {chapters.map((c) => (
                            <option key={c.id ?? ""} value={c.id ?? ""}>
                              {c.id}{c.title ? ` — ${c.title}` : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          type="text"
                          value={row.name}
                          placeholder="Category name"
                          onChange={(e) => updateRow(idx, { name: e.target.value })}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          type="number"
                          min={0}
                          value={row.target}
                          onChange={(e) =>
                            updateRow(idx, {
                              target: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className={numCls}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-slate-300">{row.have}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 text-xs ${
                            ok ? "text-emerald-400" : "text-amber-400"
                          }`}
                        >
                          {gap >= 0 ? `+${gap}` : `−${Math.abs(gap)}`}
                          {!ok && <AlertTriangle className="h-3.5 w-3.5" />}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setGenSeed({
                                chapter_id: row.chapter_id,
                                name: row.name.trim(),
                              });
                              setGenOpen(true);
                            }}
                            disabled={!row.name.trim()}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-40"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            Generate
                          </button>
                          <button
                            onClick={() => removeRow(idx)}
                            className="text-slate-600 hover:text-red-400"
                            title="Remove category"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-col gap-1 border-t border-slate-800 px-4 py-3">
          <label className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes about this exam plan…"
            rows={2}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

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

      {genOpen && (
        <GenerateDialog
          courseId={courseId}
          chapters={chapters}
          categoriesByChapter={(() => {
            // Suggestions per chapter = union of:
            //  1. Canonical syllabus list  (chapter.categories)
            //  2. Categories already observed on this chapter's questions (exam-plan rows)
            const out: Record<string, string[]> = {};
            for (const c of chapters) {
              const key = c.id ?? "";
              if (!key) continue;
              const set = new Set<string>();
              for (const cat of c.categories ?? []) {
                const s = cat.trim();
                if (s) set.add(s);
              }
              out[key] = [...set];
            }
            for (const r of rows) {
              const key = r.chapter_id ?? "";
              const name = r.name.trim();
              if (!name) continue;
              if (!out[key]) out[key] = [];
              if (!out[key].includes(name)) out[key].push(name);
            }
            return out;
          })()}
          seed={genSeed}
          materials={readyMaterials}
          onClose={() => setGenOpen(false)}
          onSubmitted={(detail) => {
            setGenOpen(false);
            setNote(detail);
          }}
        />
      )}
    </div>
  );
}

function GenerateDialog({
  courseId,
  chapters,
  categoriesByChapter,
  seed,
  materials,
  onClose,
  onSubmitted,
}: {
  courseId: string;
  chapters: SyllabusChapter[];
  categoriesByChapter: Record<string, string[]>;
  seed: { chapter_id: string | null; name: string };
  materials: Material[];
  onClose: () => void;
  onSubmitted: (detail: string) => void;
}) {
  const blank = useCallback((): GenRequest => {
    const seedKey = seed.chapter_id ?? "";
    const cats =
      categoriesByChapter[seedKey] ??
      Object.values(categoriesByChapter).flat();
    return {
      chapter_id: seed.chapter_id,
      category: seed.name || cats[0] || "",
      count: 5,
      difficulty: "mixed",
      diagrams: false,
    };
  }, [seed, categoriesByChapter]);

  const [kind, setKind] = useState<QuestionKind>("problem");
  const [requests, setRequests] = useState<GenRequest[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function updateRequest(idx: number, patch: Partial<GenRequest>) {
    setRequests((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRequest() {
    setRequests((rs) => [...rs, blank()]);
  }

  function removeRequest(idx: number) {
    setRequests((rs) => rs.filter((_, i) => i !== idx));
  }

  async function generateAll() {
    if (materials.length === 0) {
      setErr("No extracted materials — extract materials first.");
      return;
    }
    if (requests.length === 0) {
      setErr("Add at least one request row.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const materialIds = materials.map((m) => m.id);
      let total = 0;
      for (const req of requests) {
        await generateQuestions({
          course_id: courseId,
          material_ids: materialIds,
          kind,
          count: req.count,
          difficulty: req.difficulty === "mixed" ? null : Number(req.difficulty),
          chapter_id: req.chapter_id ?? null,
          category: req.category || null,
          with_diagrams: req.diagrams,
        });
        total += 1;
      }
      onSubmitted(`Queued ${total} generation ${total === 1 ? "batch" : "batches"} — generating…`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "generation failed to start");
    } finally {
      setBusy(false);
    }
  }

  const totalCount = requests.reduce((s, r) => s + r.count, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Generate questions</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Queue several requests — each row fires its own generation batch.
        </p>

        <div className="space-y-4">
          {materials.length === 0 && (
            <div className="rounded-lg border border-amber-700/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
              No extracted materials. Extract materials first — generation needs
              their text.
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-300">Question type</label>
            <select
              className={`${selectCls} w-44`}
              value={kind}
              onChange={(e) => setKind(e.target.value as QuestionKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 font-medium">Chapter</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Count</th>
                  <th className="px-3 py-2 font-medium">Difficulty</th>
                  <th className="px-3 py-2 font-medium">Diagrams</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {requests.map((req, idx) => {
                  const chapKey = req.chapter_id ?? "";
                  // Only suggest categories used INSIDE the selected chapter.
                  // Never fall back to the course-wide list — that misleads the
                  // user into thinking every category belongs to every chapter.
                  const cats = categoriesByChapter[chapKey] ?? [];
                  const datalistId = `gen-cats-${idx}-${chapKey || "unassigned"}`;
                  return (
                  <tr key={idx} className="border-t border-slate-800">
                    <td className="px-3 py-2.5">
                      <select
                        className={`${selectCls} w-full`}
                        value={req.chapter_id ?? ""}
                        onChange={(e) =>
                          updateRequest(idx, {
                            chapter_id: e.target.value || null,
                            // reset category — new chapter has its own list
                            category: "",
                          })
                        }
                      >
                        <option value="">(unassigned)</option>
                        {chapters.map((c) => (
                          <option key={c.id ?? ""} value={c.id ?? ""}>
                            {c.id}{c.title ? ` — ${c.title}` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="text"
                        value={req.category}
                        placeholder={
                          cats.length > 0
                            ? `e.g. ${cats[0]}`
                            : "type a category for this chapter"
                        }
                        list={datalistId}
                        onChange={(e) =>
                          updateRequest(idx, { category: e.target.value })
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                      />
                      <datalist id={datalistId}>
                        {cats.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={req.count}
                        onChange={(e) =>
                          updateRequest(idx, {
                            count: Math.max(
                              1,
                              Math.min(30, Number(e.target.value) || 1),
                            ),
                          })
                        }
                        className={numCls}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        className={selectCls}
                        value={req.difficulty}
                        onChange={(e) =>
                          updateRequest(idx, {
                            difficulty: e.target.value as DifficultyChoice,
                          })
                        }
                      >
                        <option value="mixed">mixed</option>
                        {[1, 2, 3, 4, 5].map((d) => (
                          <option key={d} value={String(d)}>
                            {d} / 5
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
                        <button
                          type="button"
                          onClick={() => updateRequest(idx, { diagrams: false })}
                          className={`px-2.5 py-1 text-xs ${
                            !req.diagrams
                              ? "bg-blue-500 text-white"
                              : "bg-slate-950 text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          Text only
                        </button>
                        <button
                          type="button"
                          onClick={() => updateRequest(idx, { diagrams: true })}
                          className={`px-2.5 py-1 text-xs ${
                            req.diagrams
                              ? "bg-blue-500 text-white"
                              : "bg-slate-950 text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          With diagrams
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => removeRequest(idx)}
                        disabled={requests.length === 1}
                        className="text-slate-600 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                        title="Remove request"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
                })}
              </tbody>
            </table>
          </div>

          <button
            onClick={addRequest}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600"
          >
            <Plus className="h-3.5 w-3.5" />
            Row
          </button>

          {err && <div className="text-xs text-red-400">{err}</div>}

          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-slate-500">
              {requests.length} {requests.length === 1 ? "request" : "requests"} ·{" "}
              {totalCount} questions
            </span>
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600"
            >
              Cancel
            </button>
            <button
              onClick={generateAll}
              disabled={busy || materials.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Generate all
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
