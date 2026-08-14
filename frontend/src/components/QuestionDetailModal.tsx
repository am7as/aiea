"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, X } from "lucide-react";

import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import {
  ApiError,
  getQuestion,
  questionFigureUrl,
  updateQuestion,
  type Question,
} from "@/lib/api";

type Mode = "reading" | "source" | "edit";

const FIGURE_RE = /\]\(figures\/(?:[^/]+\/)?([^)\s]+\.png)\)/g;

function rewriteFigures(md: string | null | undefined, questionId: string): string {
  if (!md) return "";
  return md.replace(FIGURE_RE, (_m, name: string) => `](${questionFigureUrl(questionId, name)})`);
}

export function QuestionDetailModal({
  questionId,
  onClose,
  onSaved,
}: {
  questionId: string;
  onClose: () => void;
  onSaved?: (updated: Question) => void;
}) {
  const [q, setQ] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("reading");
  const [draft, setDraft] = useState<{ prompt: string; answer: string; worked: string }>({
    prompt: "",
    answer: "",
    worked: "",
  });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getQuestion(questionId)
      .then((qq) => {
        if (!alive) return;
        setQ(qq);
        setDraft({
          prompt: qq.prompt_md ?? "",
          answer: qq.answer_md ?? "",
          worked: qq.worked_solution_md ?? "",
        });
        setErr(null);
      })
      .catch((e) => alive && setErr(e instanceof ApiError ? e.message : "failed to load"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [questionId]);

  const dirty =
    q != null &&
    (draft.prompt !== (q.prompt_md ?? "") ||
      draft.answer !== (q.answer_md ?? "") ||
      draft.worked !== (q.worked_solution_md ?? ""));

  async function save() {
    if (!q) return;
    setSaving(true);
    setNote(null);
    setErr(null);
    try {
      const updated = await updateQuestion(q.id, {
        prompt_md: draft.prompt,
        answer_md: draft.answer,
        worked_solution_md: draft.worked,
      });
      setQ(updated);
      onSaved?.(updated);
      setNote("Saved — wrote question.md");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  function tryClose() {
    if (dirty && !confirm("Discard unsaved edits?")) return;
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={tryClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900"
        onClick={(ev) => ev.stopPropagation()}
      >
        {/* Header — flex-shrink-0 so a tall body can't push it offscreen */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 px-5 py-3">
          <span className="text-sm font-semibold text-slate-100">Question detail</span>
          {q && (
            <>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                  q.origin === "harvested"
                    ? "bg-amber-600/20 text-amber-300"
                    : "bg-blue-600/20 text-blue-300"
                }`}
              >
                {q.origin === "harvested" ? "Reference" : "AI"}
              </span>
              {q.chapter_id && (
                <span className="font-mono text-[10px] text-slate-400">{q.chapter_id}</span>
              )}
              {q.category && (
                <span className="text-[11px] text-slate-400">· {q.category}</span>
              )}
              {q.difficulty != null && (
                <span className="font-mono text-[10px] text-slate-400">· D{q.difficulty}</span>
              )}
              {q.bloom && <span className="text-[10px] text-slate-500">· {q.bloom}</span>}
            </>
          )}
          <div className="ml-2 inline-flex overflow-hidden rounded-lg border border-slate-700">
            {(["reading", "source", "edit"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  if (dirty && m !== "edit" && !confirm("Discard unsaved edits?")) return;
                  setMode(m);
                }}
                className={`px-3 py-1 text-[11px] capitalize ${
                  mode === m
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-400 hover:text-slate-200"
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
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          )}
          <button onClick={tryClose} className="text-slate-500 hover:text-slate-200" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — min-h-0 is the key: without it, a flex child won't shrink
            below its content size, so a long worked solution overflows the
            modal and the header scrolls offscreen. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading question…
            </div>
          ) : err ? (
            <div className="text-xs text-red-300">{err}</div>
          ) : q ? (
            <div className="space-y-4">
              {note && (
                <div className="rounded-lg border border-emerald-700/40 bg-emerald-500/5 px-3 py-1.5 text-[11px] text-emerald-200">
                  {note}
                </div>
              )}
              {mode === "edit" ? (
                <div className="flex flex-col gap-3">
                  <Field
                    label="Prompt (question.md)"
                    value={draft.prompt}
                    onChange={(v) => setDraft((d) => ({ ...d, prompt: v }))}
                    rows="h-56"
                  />
                  <Field
                    label="Answer"
                    value={draft.answer}
                    onChange={(v) => setDraft((d) => ({ ...d, answer: v }))}
                    rows="h-40"
                  />
                  <Field
                    label="Worked solution"
                    value={draft.worked}
                    onChange={(v) => setDraft((d) => ({ ...d, worked: v }))}
                    rows="h-56"
                  />
                </div>
              ) : mode === "source" ? (
                <>
                  <SourceBlock label="Prompt" body={q.prompt_md} />
                  <SourceBlock label="Answer" body={q.answer_md} />
                  <SourceBlock label="Worked solution" body={q.worked_solution_md} />
                </>
              ) : (
                <>
                  <Section label="Prompt">
                    <MarkdownRenderer markdown={rewriteFigures(q.prompt_md, q.id) || "_(empty)_"} />
                  </Section>
                  {q.answer_md && (
                    <Section label="Answer">
                      <MarkdownRenderer markdown={rewriteFigures(q.answer_md, q.id)} />
                    </Section>
                  )}
                  {q.worked_solution_md && (
                    <Section label="Worked solution">
                      <MarkdownRenderer markdown={rewriteFigures(q.worked_solution_md, q.id)} />
                    </Section>
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-200">
        {children}
      </div>
    </div>
  );
}

function SourceBlock({ label, body }: { label: string; body?: string | null }) {
  if (!body) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-[11px] leading-relaxed text-slate-200">
        {body}
      </pre>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  rows = "h-44",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className={`${rows} w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-[12px] leading-relaxed text-slate-200 outline-none focus:border-blue-700 resize-none`}
      />
    </div>
  );
}
