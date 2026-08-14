"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Sparkles, Brain, Workflow, Network } from "lucide-react";

import { ApiError, api, getInventory, type Course, type InventorySnapshot } from "@/lib/api";

type Tab = "skills" | "tasks" | "workers" | "routes";

const TABS: { key: Tab; label: string; icon: typeof Sparkles }[] = [
  { key: "skills", label: "Runtime skills", icon: Sparkles },
  { key: "tasks", label: "AI tasks", icon: Brain },
  { key: "workers", label: "Worker jobs", icon: Workflow },
  { key: "routes", label: "API routes", icon: Network },
];

export function SkillsPanel() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string | undefined>(undefined);
  const [inv, setInv] = useState<InventorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("skills");
  const [q, setQ] = useState("");

  // Fetch course list once on mount; auto-select the first so course-tier skills load.
  useEffect(() => {
    (async () => {
      try {
        const list = await api<Course[]>("/courses/");
        setCourses(list);
        if (list.length > 0) setCourseId(list[0].id);
      } catch {
        // courses unavailable — inventory will still load core/global skills only
      }
    })();
  }, []);

  // Re-fetch inventory when the selected course changes (or initially with no course).
  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        setInv(await getInventory(courseId));
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "failed to load inventory");
      } finally {
        setLoading(false);
      }
    })();
  }, [courseId]);

  const filtered = useMemo(() => {
    if (!inv) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return inv;
    return {
      skills: inv.skills.filter(
        (s) =>
          s.name.toLowerCase().includes(needle) ||
          s.description.toLowerCase().includes(needle),
      ),
      ai_tasks: inv.ai_tasks.filter(
        (t) =>
          t.task.toLowerCase().includes(needle) ||
          t.description.toLowerCase().includes(needle) ||
          t.group.toLowerCase().includes(needle),
      ),
      worker_jobs: inv.worker_jobs.filter(
        (j) =>
          j.name.toLowerCase().includes(needle) ||
          j.module.toLowerCase().includes(needle),
      ),
      api_routes: inv.api_routes.filter(
        (r) =>
          r.path.toLowerCase().includes(needle) ||
          r.methods.toLowerCase().includes(needle),
      ),
    };
  }, [inv, q]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> loading inventory…
      </div>
    );
  }
  if (!inv || !filtered) {
    return (
      <div className="rounded-2xl border border-red-700/50 bg-red-500/5 px-3 py-2 text-xs text-red-300">
        {err ?? "no data"}
      </div>
    );
  }

  const coreSkills = filtered.skills.filter((s) => s.source === "global");
  const courseSkills = filtered.skills.filter((s) => s.source === "course");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
          {TABS.map((t) => {
            const I = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <I className="h-3.5 w-3.5" />
                {t.label}
                <span className="ml-1 rounded-full bg-slate-900 px-1.5 py-0.5 text-[9px] text-slate-500">
                  {
                    filtered[
                      t.key === "skills"
                        ? "skills"
                        : t.key === "tasks"
                          ? "ai_tasks"
                          : t.key === "workers"
                            ? "worker_jobs"
                            : "api_routes"
                    ].length
                  }
                </span>
              </button>
            );
          })}
        </div>
        {courses.length > 0 && (
          <div className="inline-flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Course</span>
            <select
              value={courseId ?? ""}
              onChange={(e) => setCourseId(e.target.value || undefined)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter…"
            className="w-64 rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-7 pr-3 text-xs text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {tab === "skills" && (
        <div className="space-y-6">
          <SkillSection
            title="Core skills (project)"
            subtitle="Domain-agnostic skills shipped with AIEA. Loaded for every course."
            skills={coreSkills}
          />
          <SkillSection
            title="Course skills"
            subtitle={
              courseId
                ? "Course-specific skills from the active course's brain/skills/. Override core skills with the same name."
                : "Pick a course above to see its course-specific skills."
            }
            skills={courseSkills}
            empty={
              courseId
                ? "No course-specific skills in this course's brain/skills/ yet."
                : undefined
            }
          />
        </div>
      )}

      {tab === "tasks" && (
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Task</th>
                <th className="px-3 py-2">Group</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Routed to</th>
              </tr>
            </thead>
            <tbody>
              {filtered.ai_tasks.map((t) => (
                <tr key={t.task} className="border-t border-slate-800/70 align-top">
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-200">{t.task}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-400">{t.group}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-400">{t.description}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {t.routes.length === 0 ? (
                      <span className="text-slate-600">(uses default route)</span>
                    ) : (
                      <div className="space-y-0.5">
                        {t.routes.map((r, i) => (
                          <div key={i} className="font-mono text-[11px] text-slate-300">
                            <span className="text-slate-500">{r.role}: </span>
                            {r.provider}
                            <span className="text-slate-600"> · </span>
                            {r.model}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "workers" && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <ul className="grid gap-2 sm:grid-cols-2">
            {filtered.worker_jobs.map((j) => (
              <li
                key={j.name}
                className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
              >
                <div className="font-mono text-xs font-semibold text-slate-200">{j.name}</div>
                <div className="text-[10px] text-slate-500">{j.module}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "routes" && (
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Methods</th>
                <th className="px-3 py-2">Path</th>
                <th className="px-3 py-2">Handler</th>
              </tr>
            </thead>
            <tbody>
              {filtered.api_routes.map((r) => (
                <tr key={`${r.methods}-${r.path}`} className="border-t border-slate-800/70">
                  <td className="px-3 py-2 font-mono text-[11px] text-blue-300">{r.methods}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-200">{r.path}</td>
                  <td className="px-3 py-2 text-[11px] text-slate-500">{r.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SkillSection({
  title,
  subtitle,
  skills,
  empty,
}: {
  title: string;
  subtitle: string;
  skills: { name: string; description: string; source: string }[];
  empty?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
          {title}
        </h3>
        <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-400">
          {skills.length}
        </span>
      </div>
      <p className="mb-3 text-[11px] text-slate-500">{subtitle}</p>
      {skills.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/30 px-4 py-3 text-xs text-slate-500">
          {empty ?? "Nothing here."}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {skills.map((s) => (
            <div key={s.name} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                <span className="font-mono text-xs font-semibold text-slate-200">{s.name}</span>
                <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] uppercase text-slate-500">
                  {s.source}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-400">{s.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
