"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Cpu,
  Brain,
  Database,
  Sparkles,
  Workflow,
  Activity,
  ListChecks,
  LibraryBig,
  FolderOpen,
  RefreshCw,
} from "lucide-react";

type GenDefaults = {
  count: number;
  difficulty: "mixed" | "1" | "2" | "3" | "4" | "5";
  bloom: string;
  with_diagrams: boolean;
  language: string;
};

const STORAGE_KEY = "aiea.settings.generation";

const DEFAULT_GEN: GenDefaults = {
  count: 5,
  difficulty: "mixed",
  bloom: "",
  with_diagrams: false,
  language: "en",
};

const LINKS: { href: string; label: string; icon: typeof Cpu; help: string }[] = [
  { href: "/ai/providers", label: "AI providers", icon: Cpu, help: "Connect Claude / Gemini CLI, OpenAI-compatible HTTP, LM Studio, Ollama" },
  { href: "/ai/routing", label: "Task routing", icon: Brain, help: "Assign provider + model per AI task (generation, evaluation, translate, …)" },
  { href: "/ai/memory", label: "Memory", icon: Database, help: "Tagged-markdown chat log under vault/aiea-memory/" },
  { href: "/ai/tasks", label: "Tasks", icon: ListChecks, help: "Live queue + recent ARQ jobs; cancel / retry" },
  { href: "/ai/skills", label: "Skills", icon: Sparkles, help: "Runtime skills the AI loads as prompt fragments" },
  { href: "/ai/canvas", label: "Canvas", icon: Workflow, help: "Workflow / conversation graph visualisation" },
  { href: "/monitoring", label: "Monitoring", icon: Activity, help: "Token counts, cost, per-provider usage" },
  { href: "/workspace", label: "Workspace", icon: FolderOpen, help: "Folder configuration for each course (materials/brain/library/workshop)" },
  { href: "/docs", label: "Docs", icon: LibraryBig, help: "User guide + architecture reference" },
];

export function SettingsPanel() {
  const [gen, setGen] = useState<GenDefaults>(DEFAULT_GEN);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setGen({ ...DEFAULT_GEN, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }
  }, []);

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(gen));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      /* ignore */
    }
  }

  function reset() {
    setGen(DEFAULT_GEN);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-5">
      {/* Generation defaults — client-side only, used as initial values in the
          Generate dialog. AIEA backend has no central per-user prefs. */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-sm font-semibold text-slate-200">Generation defaults</h2>
        <p className="mb-4 text-xs text-slate-500">
          Used as the initial values whenever you open the Question Generation dialog.
          Stored locally in your browser.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Default count per row">
            <input
              type="number"
              min={1}
              max={30}
              value={gen.count}
              onChange={(e) =>
                setGen({ ...gen, count: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            />
          </Field>
          <Field label="Default difficulty">
            <select
              value={gen.difficulty}
              onChange={(e) => setGen({ ...gen, difficulty: e.target.value as GenDefaults["difficulty"] })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="mixed">mixed</option>
              {[1, 2, 3, 4, 5].map((d) => (
                <option key={d} value={String(d)}>
                  {d} / 5
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default Bloom">
            <select
              value={gen.bloom}
              onChange={(e) => setGen({ ...gen, bloom: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="">any</option>
              {["remember", "understand", "apply", "analyze", "evaluate", "create"].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default diagrams">
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
              <button
                type="button"
                onClick={() => setGen({ ...gen, with_diagrams: false })}
                className={`px-3 py-1.5 text-xs ${
                  !gen.with_diagrams
                    ? "bg-blue-500 text-white"
                    : "bg-slate-950 text-slate-400 hover:text-slate-200"
                }`}
              >
                Text only
              </button>
              <button
                type="button"
                onClick={() => setGen({ ...gen, with_diagrams: true })}
                className={`px-3 py-1.5 text-xs ${
                  gen.with_diagrams
                    ? "bg-blue-500 text-white"
                    : "bg-slate-950 text-slate-400 hover:text-slate-200"
                }`}
              >
                With diagrams
              </button>
            </div>
          </Field>
          <Field label="Generation language">
            <select
              value={gen.language}
              onChange={(e) => setGen({ ...gen, language: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="en">English (always; SV added at exam render)</option>
              <option value="sv">Swedish (skip EN, use SV directly)</option>
            </select>
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={save}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600"
          >
            Save
          </button>
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reset to defaults
          </button>
          {saved && <span className="text-xs text-emerald-300">Saved.</span>}
        </div>
      </section>

      {/* Index of all configuration pages. */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-sm font-semibold text-slate-200">Configuration pages</h2>
        <p className="mb-4 text-xs text-slate-500">
          All AIEA configuration lives in the pages below. They're linked from the sidebar
          too; here's a quick index.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LINKS.map((l) => {
            const I = l.icon;
            return (
              <Link
                key={l.href}
                href={l.href}
                className="block rounded-xl border border-slate-800 bg-slate-950/60 p-3 transition hover:border-slate-600 hover:bg-slate-900"
              >
                <div className="mb-1 flex items-center gap-2">
                  <I className="h-4 w-4 text-blue-400" />
                  <span className="text-sm font-medium text-slate-200">{l.label}</span>
                </div>
                <div className="text-[11px] text-slate-500">{l.help}</div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Single-user / localhost reminder. */}
      <section className="rounded-2xl border border-amber-700/40 bg-amber-500/5 p-4 text-xs text-amber-200/90">
        <p>
          <span className="font-semibold">Single user · localhost.</span> AIEA has no auth,
          no remote storage and no telemetry. Material folders, generated questions, exams
          and chat memory all live on your machine under the paths configured in
          Workspace.
        </p>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}
