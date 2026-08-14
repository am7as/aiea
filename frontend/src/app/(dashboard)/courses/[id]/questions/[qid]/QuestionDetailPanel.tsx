"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Compass,
  Gauge,
  Languages,
  Loader2,
  MessageSquare,
  RefreshCw,
  Scale,
} from "lucide-react";

import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { questionShortId } from "@/lib/shortid";
import {
  answerQuestion,
  evaluateQuestion,
  feedbackQuestion,
  getQuestion,
  questionFigureUrl,
  similarityQuestion,
  translateQuestion,
  updateQuestion,
  type Question,
} from "@/lib/api";

type ViewMode = "reading" | "source" | "edit";

type EditDraft = {
  prompt_md: string;
  answer_md: string;
  worked_solution_md: string;
  feedback_md: string;
  difficulty: string;
  bloom: string;
  est_minutes: string;
  category: string;
};

function toDraft(q: Question): EditDraft {
  return {
    prompt_md: q.prompt_md ?? "",
    answer_md: q.answer_md ?? "",
    worked_solution_md: q.worked_solution_md ?? "",
    feedback_md: q.feedback_md ?? "",
    difficulty: q.difficulty != null ? String(q.difficulty) : "",
    bloom: q.bloom ?? "",
    est_minutes: q.est_minutes != null ? String(q.est_minutes) : "",
    category: q.category ?? "",
  };
}

const KIND: Record<string, { label: string; cls: string }> = {
  mcq: { label: "MCQ", cls: "bg-blue-600/30 text-blue-300" },
  short: { label: "Short answer", cls: "bg-emerald-600/30 text-emerald-300" },
  essay: { label: "Essay", cls: "bg-violet-600/30 text-violet-300" },
  problem: { label: "Problem", cls: "bg-amber-600/30 text-amber-300" },
  code: { label: "Code", cls: "bg-rose-600/30 text-rose-300" },
  true_false: { label: "True / False", cls: "bg-sky-600/30 text-sky-300" },
};

const BLOOM: Record<string, string> = {
  remember: "bg-slate-700 text-slate-200",
  understand: "bg-sky-600/30 text-sky-300",
  apply: "bg-emerald-600/30 text-emerald-300",
  analyze: "bg-violet-600/30 text-violet-300",
  evaluate: "bg-amber-600/30 text-amber-300",
  create: "bg-rose-600/30 text-rose-300",
};

// Matches both the legacy `figures/<id>/<fig>.png` and the new
// `figures/<fig>.png` reference style — extracting the final filename.
const FIGURE_RE = /\]\(figures\/(?:[^/]+\/)?([^)\s]+\.png)\)/g;

function rewriteFigures(md: string | null, questionId: string): string {
  if (!md) return "";
  return md.replace(FIGURE_RE, (_m, name: string) => `](${questionFigureUrl(questionId, name)})`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function QuestionDetailPanel({
  courseId,
  courseCode,
  initial,
}: {
  courseId: string;
  courseCode?: string;
  initial: Question;
}) {
  const [question, setQuestion] = useState<Question>(initial);
  const [answering, setAnswering] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [feedbacking, setFeedbacking] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [similaring, setSimilaring] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("reading");
  const [draft, setDraft] = useState<EditDraft>(() => toDraft(initial));
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const liveRef = useRef(true);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  const resync = useCallback(async () => {
    setSyncing(true);
    try {
      const next = await getQuestion(question.id);
      if (liveRef.current) setQuestion(next);
    } catch {
      /* keep current */
    } finally {
      if (liveRef.current) setSyncing(false);
    }
  }, [question.id]);

  const runAnswer = useCallback(async () => {
    setNote(null);
    setAnswering(true);
    const before = {
      answer: question.answer_md,
      solution: question.worked_solution_md,
    };
    try {
      await answerQuestion(question.id);
      let changed = false;
      for (let i = 0; i < 20; i += 1) {
        await sleep(4000);
        if (!liveRef.current) return;
        const next = await getQuestion(question.id);
        if (liveRef.current) setQuestion(next);
        if (
          next.answer_md !== before.answer ||
          next.worked_solution_md !== before.solution
        ) {
          changed = true;
          break;
        }
      }
      if (liveRef.current) {
        setNote(changed ? "Answer generated." : "Answer run finished — no change yet (check worker logs).");
      }
    } catch (err) {
      if (liveRef.current) {
        setNote(err instanceof Error ? err.message : "Answer run failed to start.");
      }
    } finally {
      if (liveRef.current) setAnswering(false);
    }
  }, [question.id, question.answer_md, question.worked_solution_md]);

  const runEvaluate = useCallback(async () => {
    setNote(null);
    setEvaluating(true);
    const before = question.eval_correctness;
    try {
      await evaluateQuestion(question.id);
      let changed = false;
      for (let i = 0; i < 20; i += 1) {
        await sleep(4000);
        if (!liveRef.current) return;
        const next = await getQuestion(question.id);
        if (liveRef.current) setQuestion(next);
        if (next.eval_correctness != null && next.eval_correctness !== before) {
          changed = true;
          break;
        }
      }
      if (liveRef.current) {
        setNote(changed ? "Evaluation finished." : "Evaluation run finished — no score yet (check worker logs).");
      }
    } catch (err) {
      if (liveRef.current) {
        setNote(err instanceof Error ? err.message : "Evaluation run failed to start.");
      }
    } finally {
      if (liveRef.current) setEvaluating(false);
    }
  }, [question.id, question.eval_correctness]);

  const runFeedback = useCallback(async () => {
    setNote(null);
    setFeedbacking(true);
    const before = question.feedback_md;
    try {
      await feedbackQuestion(question.id);
      let changed = false;
      for (let i = 0; i < 20; i += 1) {
        await sleep(4000);
        if (!liveRef.current) return;
        const next = await getQuestion(question.id);
        if (liveRef.current) setQuestion(next);
        if (next.feedback_md != null && next.feedback_md !== before) {
          changed = true;
          break;
        }
      }
      if (liveRef.current) {
        setNote(changed ? "Feedback generated." : "Feedback run finished — nothing new yet (check worker logs).");
      }
    } catch (err) {
      if (liveRef.current) {
        setNote(err instanceof Error ? err.message : "Feedback run failed to start.");
      }
    } finally {
      if (liveRef.current) setFeedbacking(false);
    }
  }, [question.id, question.feedback_md]);

  const runSimilarity = useCallback(async () => {
    setNote(null);
    setSimilaring(true);
    const before = question.reference_deviation;
    try {
      await similarityQuestion(question.id);
      let changed = false;
      for (let i = 0; i < 20; i += 1) {
        await sleep(3000);
        if (!liveRef.current) return;
        const next = await getQuestion(question.id);
        if (liveRef.current) setQuestion(next);
        if (
          next.reference_deviation != null &&
          next.reference_deviation !== before
        ) {
          changed = true;
          break;
        }
        if (next.reference_match_note && next.reference_match_note !== question.reference_match_note) {
          changed = true;
          break;
        }
      }
      if (liveRef.current) {
        setNote(
          changed
            ? "Reference similarity scored."
            : "Similarity run finished — no change yet (check worker logs).",
        );
      }
    } catch (err) {
      if (liveRef.current) {
        setNote(err instanceof Error ? err.message : "Similarity run failed to start.");
      }
    } finally {
      if (liveRef.current) setSimilaring(false);
    }
  }, [question.id, question.reference_deviation, question.reference_match_note]);

  const runTranslate = useCallback(async () => {
    setNote(null);
    setTranslating(true);
    const refresh = !!question.translation_sv;
    try {
      const res = await translateQuestion(question.id, refresh);
      if (!liveRef.current) return;
      setQuestion((q) => ({ ...q, translation_sv: res.translation_sv }));
      setNote(
        res.translation_sv
          ? refresh
            ? "Translation refreshed."
            : "Translation generated."
          : "No translate route configured — set one in /ai/routing.",
      );
    } catch (err) {
      if (liveRef.current) {
        setNote(err instanceof Error ? err.message : "Translation failed.");
      }
    } finally {
      if (liveRef.current) setTranslating(false);
    }
  }, [question.id, question.translation_sv]);

  const enterMode = useCallback(
    (next: ViewMode) => {
      if (next === "edit") {
        setDraft(toDraft(question));
        setSaveNote(null);
      }
      setMode(next);
    },
    [question],
  );

  const cancelEdit = useCallback(() => {
    setDraft(toDraft(question));
    setSaveNote(null);
    setMode("reading");
  }, [question]);

  const saveEdit = useCallback(async () => {
    setSaveNote(null);
    setSaving(true);
    const patch: Partial<{
      prompt_md: string;
      answer_md: string;
      worked_solution_md: string;
      feedback_md: string;
      difficulty: number;
      bloom: string;
      est_minutes: number;
      category: string;
    }> = {};
    if (draft.prompt_md !== (question.prompt_md ?? "")) patch.prompt_md = draft.prompt_md;
    if (draft.answer_md !== (question.answer_md ?? "")) patch.answer_md = draft.answer_md;
    if (draft.worked_solution_md !== (question.worked_solution_md ?? "")) {
      patch.worked_solution_md = draft.worked_solution_md;
    }
    if (draft.feedback_md !== (question.feedback_md ?? "")) {
      patch.feedback_md = draft.feedback_md;
    }
    if (draft.category !== (question.category ?? "")) patch.category = draft.category;
    if (draft.bloom !== (question.bloom ?? "")) patch.bloom = draft.bloom;
    const curDifficulty = question.difficulty != null ? String(question.difficulty) : "";
    if (draft.difficulty !== curDifficulty && draft.difficulty.trim() !== "") {
      patch.difficulty = Number(draft.difficulty);
    }
    const curMinutes = question.est_minutes != null ? String(question.est_minutes) : "";
    if (draft.est_minutes !== curMinutes && draft.est_minutes.trim() !== "") {
      patch.est_minutes = Number(draft.est_minutes);
    }
    if (Object.keys(patch).length === 0) {
      setSaving(false);
      setSaveNote({ kind: "ok", text: "No changes to save." });
      return;
    }
    try {
      const next = await updateQuestion(
        question.id,
        patch as Parameters<typeof updateQuestion>[1],
      );
      if (liveRef.current) {
        setQuestion(next);
        setDraft(toDraft(next));
        setSaveNote({ kind: "ok", text: "Saved." });
      }
    } catch (err) {
      if (liveRef.current) {
        setSaveNote({
          kind: "err",
          text: err instanceof Error ? err.message : "Save failed.",
        });
      }
    } finally {
      if (liveRef.current) setSaving(false);
    }
  }, [draft, question]);

  const kind = KIND[question.kind] ?? { label: question.kind, cls: "bg-slate-700 text-slate-200" };
  const busy = answering || evaluating || feedbacking || translating || similaring;
  const isHarvested = question.origin === "harvested";
  const showDistractors = question.kind === "mcq" || question.kind === "true_false";

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
        <span className="text-sm font-semibold text-slate-100">Question</span>
        <span
          className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
          title={`UUID ${question.id}`}
        >
          {questionShortId({
            courseCode,
            uuid: question.id,
            chapterId: question.chapter_id,
            origin: question.origin,
          })}
        </span>
        <span className="text-slate-600">·</span>
        {question.category && (
          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300">
            {question.category}
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[10px] ${kind.cls}`}>{kind.label}</span>
        {question.difficulty != null && (
          <span className="flex items-center gap-1 text-[11px] text-slate-400">
            <Gauge className="h-3 w-3" />D{question.difficulty}
          </span>
        )}
        <span className="text-[11px] text-slate-500">{question.status}</span>

        <div className="flex-1" />

        <div className="inline-flex rounded-lg border border-slate-700 p-0.5">
          {(["reading", "source", "edit"] as const).map((m) => (
            <button
              key={m}
              onClick={() => enterMode(m)}
              className={`rounded-md px-2.5 py-1 text-xs capitalize transition-colors ${
                mode === m
                  ? "bg-slate-700 text-slate-100"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <button
          onClick={runAnswer}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-600 disabled:opacity-50"
        >
          {answering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Answer
        </button>
        <button
          onClick={runEvaluate}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {evaluating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Evaluate
        </button>
        <button
          onClick={runFeedback}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-600 disabled:opacity-50"
        >
          {feedbacking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MessageSquare className="h-3.5 w-3.5" />
          )}
          Feedback
        </button>
        <button
          onClick={runTranslate}
          disabled={busy}
          title={question.translation_sv ? "Refresh Swedish translation" : "Translate to Swedish"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-600 disabled:opacity-50"
        >
          {translating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Languages className="h-3.5 w-3.5" />
          )}
          {question.translation_sv ? "Re-translate" : "Translate"}
        </button>
        {!isHarvested && (
          <button
            onClick={runSimilarity}
            disabled={busy}
            title="Compare to harvested (reference) questions on the same topic"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-600 disabled:opacity-50"
          >
            {similaring ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Scale className="h-3.5 w-3.5" />
            )}
            Reference match
          </button>
        )}
        <button
          onClick={resync}
          disabled={syncing || busy}
          title="Resync"
          className="inline-flex items-center justify-center rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:border-slate-600 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {note && (
        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
          {note}
        </div>
      )}

      {/* two-column body */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* left — wider */}
        <div className="space-y-4 lg:col-span-2">
          {mode === "reading" && (
            <>
              <Card title="Question">
                {question.prompt_md ? (
                  <MarkdownRenderer markdown={rewriteFigures(question.prompt_md, question.id)} />
                ) : (
                  <Empty />
                )}
                {showDistractors && question.distractors.length > 0 && (
                  <div className="mt-3">
                    <SectionLabel>Distractors</SectionLabel>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
                      {question.distractors.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>

              {question.translation_sv && (
                <Card title="Swedish translation">
                  <div className="mb-2 text-xs text-slate-500">
                    Rendered below the English question in the bilingual exam PDF.
                  </div>
                  <MarkdownRenderer
                    markdown={rewriteFigures(question.translation_sv, question.id)}
                  />
                </Card>
              )}

              <Card title="Answer / Worked solution">
                <SectionLabel>Answer</SectionLabel>
                {question.answer_md ? (
                  <MarkdownRenderer markdown={rewriteFigures(question.answer_md, question.id)} />
                ) : (
                  <Empty />
                )}
                <div className="mt-3">
                  <SectionLabel>Worked solution</SectionLabel>
                  {question.worked_solution_md ? (
                    <MarkdownRenderer
                      markdown={rewriteFigures(question.worked_solution_md, question.id)}
                    />
                  ) : (
                    <Empty />
                  )}
                </div>
              </Card>

              <Card title="Evaluation">
                {question.evaluation_md ? (
                  <MarkdownRenderer markdown={rewriteFigures(question.evaluation_md, question.id)} />
                ) : (
                  <Empty label="Not evaluated yet — run Evaluate." />
                )}
              </Card>

              <Card title="Scope alignment">
                {question.scope_alignment != null ? (
                  <div className="space-y-2">
                    <ScoreBar label="alignment with course scope" value={question.scope_alignment} />
                    {question.off_topic_reason && question.scope_alignment < 7 ? (
                      <div className="rounded-lg border border-amber-700/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
                        <span className="font-semibold">Off-topic note · </span>
                        {question.off_topic_reason}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500">
                        On topic — no off-scope concerns flagged.
                      </div>
                    )}
                  </div>
                ) : (
                  <Empty label="Run Evaluate to score how well this question fits the course scope." />
                )}
              </Card>

              {!isHarvested && (
                <Card title="Reference match">
                  {question.reference_match_note || question.reference_deviation != null ? (
                    <div className="space-y-2">
                      {question.reference_deviation != null && (
                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="text-slate-400">deviation from harvested set</span>
                            <span className="font-mono text-slate-300">
                              {question.reference_deviation.toFixed(1)} / 10
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full ${
                                question.reference_deviation < 3
                                  ? "bg-emerald-500"
                                  : question.reference_deviation < 6
                                  ? "bg-amber-500"
                                  : "bg-red-500"
                              }`}
                              style={{
                                width: `${Math.min(100, (question.reference_deviation / 10) * 100)}%`,
                              }}
                            />
                          </div>
                          <div className="mt-1 flex justify-between text-[10px] text-slate-600">
                            <span>0 — drop-in</span>
                            <span>5 — same topic, different angle</span>
                            <span>10 — out of scope</span>
                          </div>
                        </div>
                      )}
                      {question.reference_match_note && (
                        <div className="text-sm text-slate-300">{question.reference_match_note}</div>
                      )}
                      {question.closest_reference_id && (
                        <Link
                          href={`/courses/${courseId}/questions/${question.closest_reference_id}`}
                          className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200"
                        >
                          Open closest reference
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                  ) : (
                    <Empty label="Run Reference match to compare this question with the course's past exams." />
                  )}
                </Card>
              )}

              {question.feedback_md && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    AI feedback
                  </div>
                  <div className="mb-3 text-xs text-slate-500">
                    Critique of question + answers + difficulty, with one concrete improvement.
                  </div>
                  <MarkdownRenderer markdown={rewriteFigures(question.feedback_md, question.id)} />
                </div>
              )}
            </>
          )}

          {mode === "source" && (
            <>
              <Card title="Question — source">
                <SourceBlock value={question.prompt_md} />
              </Card>
              <Card title="Answer — source">
                <SourceBlock value={question.answer_md} />
              </Card>
              <Card title="Worked solution — source">
                <SourceBlock value={question.worked_solution_md} />
              </Card>
            </>
          )}

          {mode === "edit" && (
            <>
              <Card title="Edit — question">
                <SectionLabel>Prompt (markdown)</SectionLabel>
                <EditTextarea
                  value={draft.prompt_md}
                  onChange={(v) => setDraft((d) => ({ ...d, prompt_md: v }))}
                  rows={8}
                />
                <div className="mt-3">
                  <SectionLabel>Answer (markdown)</SectionLabel>
                  <EditTextarea
                    value={draft.answer_md}
                    onChange={(v) => setDraft((d) => ({ ...d, answer_md: v }))}
                    rows={6}
                  />
                </div>
                <div className="mt-3">
                  <SectionLabel>Worked solution (markdown)</SectionLabel>
                  <EditTextarea
                    value={draft.worked_solution_md}
                    onChange={(v) => setDraft((d) => ({ ...d, worked_solution_md: v }))}
                    rows={8}
                  />
                </div>
                <div className="mt-3">
                  <SectionLabel>AI feedback (markdown)</SectionLabel>
                  <EditTextarea
                    value={draft.feedback_md}
                    onChange={(v) => setDraft((d) => ({ ...d, feedback_md: v }))}
                    rows={6}
                  />
                </div>
              </Card>

              <Card title="Edit — metadata">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <EditField label="difficulty">
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={draft.difficulty}
                      onChange={(e) => setDraft((d) => ({ ...d, difficulty: e.target.value }))}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-slate-500"
                    />
                  </EditField>
                  <EditField label="bloom">
                    <input
                      type="text"
                      value={draft.bloom}
                      onChange={(e) => setDraft((d) => ({ ...d, bloom: e.target.value }))}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-slate-500"
                    />
                  </EditField>
                  <EditField label="est. minutes">
                    <input
                      type="number"
                      min={0}
                      value={draft.est_minutes}
                      onChange={(e) => setDraft((d) => ({ ...d, est_minutes: e.target.value }))}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-slate-500"
                    />
                  </EditField>
                  <EditField label="category">
                    <input
                      type="text"
                      value={draft.category}
                      onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-slate-500"
                    />
                  </EditField>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    onClick={saveEdit}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-600 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  {saveNote && (
                    <span
                      className={`text-xs ${
                        saveNote.kind === "err" ? "text-red-300" : "text-emerald-300"
                      }`}
                    >
                      {saveNote.text}
                    </span>
                  )}
                </div>
              </Card>
            </>
          )}
        </div>

        {/* right — narrower */}
        <div className="space-y-4">
          <Card title="Scorecard">
            <ScoreBar label="correctness" value={question.eval_correctness} />
            <div className="mt-3">
              <ScoreBar label="clarity" value={question.eval_clarity} />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="difficulty">
                {question.difficulty != null ? `${question.difficulty} / 5` : "—"}
              </Stat>
              <Stat label="bloom">
                {question.bloom ? (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${BLOOM[question.bloom] ?? "bg-slate-700 text-slate-200"}`}>
                    {question.bloom}
                  </span>
                ) : (
                  "—"
                )}
              </Stat>
              <Stat label="est. time">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {question.est_minutes != null ? `${question.est_minutes} min` : "—"}
                </span>
              </Stat>
            </div>
            <div className="mt-4">
              {question.needs_human_review ? (
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-red-700/50 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Needs human review
                </div>
              ) : (
                <div className="text-xs text-slate-500">No review flag set.</div>
              )}
            </div>
          </Card>

          <Card title="Provenance">
            <dl className="space-y-2 text-xs">
              <Prov label="origin" value={question.origin} />
              <Prov label="created by" value={question.created_by} />
              <Prov label="source ref" value={question.source_ref} mono />
              <Prov label="category" value={question.category} />
              <Prov
                label="pages"
                value={question.source_pages.length > 0 ? question.source_pages.join(", ") : null}
              />
              <Prov
                label="topics"
                value={question.topics.length > 0 ? question.topics.join(", ") : null}
              />
              <Prov label="chapter" value={question.chapter_id} mono />
              <Prov
                label="ELOs"
                value={question.elo_ids.length > 0 ? question.elo_ids.join(", ") : null}
                mono
              />
              <Prov label="iteration" value={String(question.current_iteration)} />
              <Prov label="vault path" value={question.vault_path} mono />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </div>
      {children}
    </div>
  );
}

function SourceBlock({ value }: { value: string | null }) {
  if (!value) return <Empty />;
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs leading-relaxed text-slate-300">
      {value}
    </pre>
  );
}

function EditTextarea({
  value,
  onChange,
  rows,
}: {
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      spellCheck={false}
      className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950/60 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-slate-500"
    />
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </div>
  );
}

function Empty({ label = "—" }: { label?: string }) {
  return <div className="text-sm text-slate-500">{label}</div>;
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const has = value != null;
  const pct = has ? Math.max(0, Math.min(100, (value / 10) * 100)) : 0;
  const tone =
    !has ? "bg-slate-700" : value >= 7 ? "bg-emerald-500" : value >= 4 ? "bg-amber-500" : "bg-red-500";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono text-slate-300">{has ? `${value} / 10` : "—"}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-200">{children}</div>
    </div>
  );
}

function Prov({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-slate-500">{label}</dt>
      <dd className={`min-w-0 break-words text-slate-300 ${mono ? "font-mono text-[11px]" : ""}`}>
        {value ?? <span className="text-slate-600">—</span>}
      </dd>
    </div>
  );
}
