"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleSlash,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";

import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import {
  type ExamFindings,
  type ExamSummary,
  type Finding,
  getExamFindings,
  listExams,
  overrideExamValidation,
  patchFinding,
  repairFinding,
  validateExam,
} from "@/lib/api";

const SEVERITY = {
  blocking: {
    label: "Blocking",
    icon: ShieldAlert,
    chip: "border-red-700/50 bg-red-500/10 text-red-300",
    dot: "bg-red-500",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    chip: "border-amber-700/50 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-500",
  },
  note: {
    label: "Note",
    icon: Info,
    chip: "border-slate-700/60 bg-slate-500/10 text-slate-300",
    dot: "bg-slate-500",
  },
} as const;

const STATUS_CHIP: Record<string, string> = {
  clean: "border-emerald-700/50 bg-emerald-500/10 text-emerald-300",
  blocked: "border-red-700/50 bg-red-500/10 text-red-300",
  overridden: "border-amber-700/50 bg-amber-500/10 text-amber-300",
  unvalidated: "border-slate-700/60 bg-slate-800/40 text-slate-400",
};

export default function ValidationPanel({ courseId }: { courseId: string }) {
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [examId, setExamId] = useState<string>("");
  const [data, setData] = useState<ExamFindings | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string>("");
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    listExams(courseId)
      .then((rows) => {
        if (!live.current) return;
        setExams(rows);
        if (rows.length && !examId) setExamId(rows[0].id);
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const load = useCallback(async () => {
    if (!examId) return;
    try {
      const res = await getExamFindings(examId);
      if (live.current) setData(res);
    } catch (e) {
      if (live.current) setError(String(e));
    }
  }, [examId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Validation is an ARQ job, so poll until validated_at moves. Mirrors the
   * pollAfterJob pattern the exam bank uses for render/compile. */
  const runValidation = async (deep: boolean) => {
    if (!examId) return;
    setBusy(deep ? "deep" : "quick");
    setNote(deep ? "Running the AI reviewers — this takes a few minutes…" : "Validating…");
    setError("");
    const before = data?.validated_at ?? null;
    try {
      await validateExam(examId, deep);
      for (let i = 0; i < (deep ? 90 : 20); i++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (!live.current) return;
        const res = await getExamFindings(examId);
        if (res.validated_at !== before) {
          setData(res);
          setNote(
            `Validation finished — ${res.counts.blocking} blocking, ${res.counts.warning} warning.`,
          );
          setBusy("");
          return;
        }
      }
      setNote("Validation is taking longer than expected — see AI → Tasks.");
    } catch (e) {
      setError(String(e));
    } finally {
      if (live.current) setBusy("");
    }
  };

  const rule = async (finding: Finding, status: "accepted" | "dismissed" | "open") => {
    setBusy(finding.id);
    try {
      await patchFinding(finding.id, status);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      if (live.current) setBusy("");
    }
  };

  const fix = async (finding: Finding) => {
    setBusy(finding.id);
    setError("");
    try {
      const res = await repairFinding(finding.id, false);
      if (res.applied) {
        setNote(`Fixed: ${res.change_summary}`);
      } else if (res.blocked_reason) {
        setNote(`Needs a decision: ${res.blocked_reason}`);
      } else {
        setNote(
          `Proposed: ${res.change_summary || "a rewrite is available"} — review it on the question page before accepting.`,
        );
      }
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      if (live.current) setBusy("");
    }
  };

  const doOverride = async () => {
    const reason = window.prompt(
      "Compiling past blocking findings is allowed, but the reason is recorded on the exam.\n\nWhy is this acceptable?",
      data?.override_reason ?? "",
    );
    if (reason === null) return;
    setBusy("override");
    try {
      await overrideExamValidation(examId, reason);
      await load();
      setNote(reason.trim() ? "Override recorded." : "Override withdrawn.");
    } catch (e) {
      setError(String(e));
    } finally {
      if (live.current) setBusy("");
    }
  };

  const groups: Finding["severity"][] = ["blocking", "warning", "note"];
  const status = data?.validation_status ?? "unvalidated";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <select
          value={examId}
          onChange={(e) => setExamId(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
        >
          {exams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>

        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
            STATUS_CHIP[status] ?? STATUS_CHIP.unvalidated
          }`}
        >
          {status}
        </span>

        {data && (
          <span className="text-xs text-slate-400">
            {data.counts.blocking} blocking · {data.counts.warning} warning · {data.counts.note} note
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void runValidation(false)}
            disabled={!!busy}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy === "quick" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            Validate
          </button>
          <button
            onClick={() => void runValidation(true)}
            disabled={!!busy}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            title="Also runs the blind solver, examiner and syllabus auditor"
          >
            {busy === "deep" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Deep review
          </button>
          <button
            onClick={() => void load()}
            className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {note && (
        <div className="rounded-xl border border-emerald-700/50 bg-emerald-500/5 px-4 py-2 text-sm text-emerald-300">
          {note}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-700/50 bg-red-500/5 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {data && data.counts.blocking > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-700/50 bg-red-500/5 p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div className="flex-1 text-sm text-red-200">
            <p className="font-semibold">This exam cannot be compiled.</p>
            <p className="mt-1 text-red-300/80">
              {data.counts.blocking} blocking finding{data.counts.blocking === 1 ? "" : "s"} must be
              fixed, dismissed, or explicitly overridden with a reason.
            </p>
            {data.override_reason && (
              <p className="mt-2 rounded-lg border border-amber-700/50 bg-amber-500/5 px-3 py-2 text-amber-200">
                Overridden: {data.override_reason}
              </p>
            )}
          </div>
          <button
            onClick={() => void doOverride()}
            disabled={busy === "override"}
            className="shrink-0 rounded-lg border border-amber-700/60 px-3 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/10"
          >
            {data.override_reason ? "Edit override" : "Override…"}
          </button>
        </div>
      )}

      {data && data.findings.length === 0 && (
        <div className="rounded-2xl border border-emerald-800/50 bg-emerald-500/5 p-8 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-emerald-400" />
          <p className="mt-3 text-sm font-medium text-emerald-300">No open findings.</p>
          <p className="mt-1 text-xs text-emerald-400/70">
            {status === "unvalidated"
              ? "This exam has not been validated yet."
              : "Every rule passed on the last run."}
          </p>
        </div>
      )}

      {groups.map((sev) => {
        const rows = (data?.findings ?? []).filter((f) => f.severity === sev);
        if (!rows.length) return null;
        const meta = SEVERITY[sev];
        const Icon = meta.icon;
        return (
          <section
            key={sev}
            className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40"
          >
            <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
              <Icon className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-200">{meta.label}</h2>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                {rows.length}
              </span>
            </header>
            <div>
              {rows.map((f) => (
                <article
                  key={f.id}
                  className="border-b border-slate-800/70 p-4 last:border-b-0"
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium text-slate-100">{f.title}</h3>
                        <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
                          {f.rule_id}
                        </code>
                        {f.auto_fixable && (
                          <span className="rounded-full border border-blue-700/50 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-300">
                            auto-fixable
                          </span>
                        )}
                      </div>
                      {f.detail_md && (
                        <div className="mt-2 text-sm text-slate-400">
                          <MarkdownRenderer markdown={f.detail_md} />
                        </div>
                      )}
                      {f.question_id && (
                        <a
                          href={`/courses/${courseId}/questions/${f.question_id}`}
                          className="mt-2 inline-block text-xs text-blue-400 hover:underline"
                        >
                          Open the question →
                        </a>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {f.question_id && (
                        <button
                          onClick={() => void fix(f)}
                          disabled={busy === f.id}
                          title={
                            f.auto_fixable
                              ? "Apply the deterministic fix"
                              : "Ask for a proposed rewrite"
                          }
                          className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                        >
                          {busy === f.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Wrench className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => void rule(f, "accepted")}
                        title="Accept — intentional, stop reporting it"
                        className="rounded-lg border border-slate-700 p-2 text-emerald-400 hover:bg-slate-800"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => void rule(f, "dismissed")}
                        title="Dismiss — not a real problem"
                        className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:bg-slate-800"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}

      {data && status !== "unvalidated" && (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <CircleSlash className="h-3 w-3" />
          Accepted and dismissed findings survive re-validation, so a decision is only made
          once.
        </p>
      )}
    </div>
  );
}
