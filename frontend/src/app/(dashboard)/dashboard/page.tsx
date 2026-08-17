import Link from "next/link";
import {
  Plus,
  FolderOpen,
  Brain,
  BookMarked,
  Hammer,
  BookOpen,
  FileText,
  HelpCircle,
  ClipboardList,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";

import { TopBar } from "@/components/TopBar";
import { KpiCard } from "@/components/KpiCard";
import { cn } from "@/lib/cn";
import { api, getCourseContents, type Course, type CourseContents } from "@/lib/api";

export const dynamic = "force-dynamic";

async function loadCourses(): Promise<Course[]> {
  try {
    return await api<Course[]>("/courses/");
  } catch {
    return [];
  }
}

async function loadContentsSafe(courseId: string): Promise<CourseContents | null> {
  try {
    return await getCourseContents(courseId);
  } catch {
    return null;
  }
}

const ROLE_META = {
  materials: { icon: FolderOpen, color: "text-blue-400", bg: "bg-blue-500/15" },
  brain: { icon: Brain, color: "text-violet-400", bg: "bg-violet-500/15" },
  library: { icon: BookMarked, color: "text-green-400", bg: "bg-green-500/15" },
  workshop: { icon: Hammer, color: "text-amber-400", bg: "bg-amber-500/15" },
} as const;

const ROLE_ORDER = ["materials", "brain", "library", "workshop"] as const;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const courses = await loadCourses();
  const { course: courseParam } = await searchParams;

  if (courses.length === 0) {
    return (
      <>
        <TopBar
          title="Dashboard"
          subtitle="No courses yet — create one to start."
        />
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-16 text-center">
          <p className="text-slate-300 mb-2 text-lg">Set up your first course</p>
          <p className="text-slate-500 text-sm mb-6 max-w-md mx-auto">
            A course owns four folders (materials, brain, library, workshop) plus its metadata.
            After creating it, configure the folders under <Link href="/workspace" className="text-blue-400 hover:text-blue-300">Workspace</Link>.
          </p>
          <Link
            href="/courses/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            New course
          </Link>
        </div>
      </>
    );
  }

  const active = courses.find((c) => c.id === courseParam) ?? courses[0];
  const contents = await loadContentsSafe(active.id);

  const folderHealth = ROLE_ORDER.map((role) => {
    const path = active[`${role}_path` as const];
    const data = contents?.[role];
    return {
      role,
      path,
      exists: data?.exists ?? false,
      files: data?.sections?.reduce((a, s) => a + s.count, 0) ?? 0,
    };
  });

  const healthCount = folderHealth.filter((f) => f.path && f.exists).length;
  const allHealthy = healthCount === 4;
  const noPaths = folderHealth.every((f) => !f.path);

  // KPI numbers from the contents snapshot (live disk truth) where possible
  const materialsFiles = contents?.materials.sections.reduce((a, s) => a + s.count, 0) ?? active.materials_count;
  const workshopQuestions = contents?.workshop.sections.find((s) => s.name === "questions")?.count ?? 0;
  const libraryQuestions = contents?.library.sections.find((s) => s.name === "question-bank")?.count ?? 0;
  const libraryExams = contents?.library.sections.find((s) => s.name === "exams")?.count ?? 0;

  return (
    <>
      <TopBar
        title="Dashboard"
        subtitle={`${active.code} · ${active.title}${active.language ? ` · ${active.language}` : ""}`}
        action={
          courses.length > 1 ? (
            <Link
              href={`/workspace?course=${active.id}`}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              Switch course in Workspace <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : null
        }
      />

      <section
        className={cn(
          "rounded-2xl border p-5 mb-6",
          allHealthy
            ? "border-slate-800 bg-slate-900/60"
            : "border-amber-500/30 bg-amber-500/5",
        )}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-100">Folder health</h2>
            {!allHealthy && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-[11px]">
                <AlertTriangle className="h-3 w-3" />
                {noPaths
                  ? "no paths set"
                  : `${healthCount}/4 ready`}
              </span>
            )}
          </div>
          <Link
            href={`/workspace?course=${active.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300"
          >
            Manage <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {folderHealth.map((f) => {
            const meta = ROLE_META[f.role];
            const Icon = meta.icon;
            const state = !f.path ? "unset" : !f.exists ? "missing" : "ok";
            return (
              <div
                key={f.role}
                className={cn(
                  "rounded-xl border bg-slate-950/40 p-3 flex items-center gap-3",
                  state === "ok" && "border-slate-800",
                  state === "missing" && "border-rose-500/30",
                  state === "unset" && "border-slate-800/60 opacity-70",
                )}
              >
                <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center shrink-0", meta.bg, meta.color)}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={cn("text-xs font-medium capitalize", meta.color)}>{f.role}</div>
                  <div className="text-[11px] text-slate-500 truncate font-mono">
                    {f.path ?? "not set"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {state === "ok" && (
                    <div className="text-xs text-slate-400 tabular-nums">{f.files}</div>
                  )}
                  {state === "missing" && (
                    <div className="text-[11px] text-rose-300">missing</div>
                  )}
                  {state === "unset" && (
                    <div className="text-[11px] text-slate-500">—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KpiCard icon={BookOpen} title="Courses" value={courses.length} accent="blue" />
        <KpiCard
          icon={FileText}
          title="Materials"
          value={materialsFiles}
          caption={contents ? "files on disk" : "registered in DB"}
          accent="violet"
        />
        <KpiCard
          icon={HelpCircle}
          title="Questions"
          value={active.questions_count}
          caption={`${libraryQuestions} promoted · ${Math.max(active.questions_count - libraryQuestions, 0)} drafts`}
          accent="green"
        />
        <KpiCard
          icon={ClipboardList}
          title="Exams"
          value={libraryExams}
          caption="finalized"
          accent="amber"
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-100">Courses</h2>
            <Link
              href="/courses"
              className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300"
            >
              All courses <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <ul className="divide-y divide-slate-800/70">
            {courses.slice(0, 5).map((c) => (
              <li key={c.id} className="py-2.5 flex items-center justify-between gap-3">
                <Link
                  href={`/courses/${c.id}`}
                  className="flex-1 min-w-0 hover:text-slate-100"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-slate-500 shrink-0">{c.code}</span>
                    <span className="text-sm text-slate-200 truncate">{c.title}</span>
                    {c.id === active.id && (
                      <span className="text-[10px] uppercase tracking-wider text-blue-400 shrink-0">active</span>
                    )}
                  </div>
                </Link>
                <Link
                  href={`/workspace?course=${c.id}`}
                  className="text-[11px] text-slate-500 hover:text-slate-300 shrink-0"
                >
                  workspace →
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-slate-100">Next steps</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Suggested actions for the active course.</p>
          </div>
          <ul className="space-y-2 text-sm">
            <NextStep
              done={allHealthy}
              label="Connect the four folders"
              href={`/workspace?course=${active.id}`}
              cta={allHealthy ? "Manage" : "Connect now"}
            />
            <NextStep
              done={materialsFiles > 0}
              label="Drop materials in & ingest"
              href={`/courses/${active.id}`}
              cta={materialsFiles > 0 ? "Scan again" : "Open course"}
            />
            <NextStep
              done={workshopQuestions + libraryQuestions > 0}
              label="Generate questions"
              href="/questions"
              cta="Generate"
              disabled
            />
            <NextStep
              done={libraryExams > 0}
              label="Assemble an exam"
              href="/exams"
              cta="Build"
              disabled
            />
          </ul>
        </div>
      </section>
    </>
  );
}

function NextStep({
  done,
  label,
  href,
  cta,
  disabled = false,
}: {
  done: boolean;
  label: string;
  href: string;
  cta: string;
  disabled?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn(
            "h-5 w-5 rounded-full border flex items-center justify-center text-[10px] shrink-0",
            done ? "bg-green-500/20 border-green-500/40 text-green-300" : "bg-slate-800/80 border-slate-700 text-slate-500",
          )}
        >
          {done ? "✓" : ""}
        </span>
        <span className={cn("truncate", done ? "text-slate-400 line-through" : "text-slate-200")}>{label}</span>
      </div>
      {disabled ? (
        <span className="text-[11px] text-slate-600 shrink-0">soon</span>
      ) : (
        <Link href={href} className="text-[11px] text-blue-400 hover:text-blue-300 shrink-0">
          {cta} →
        </Link>
      )}
    </li>
  );
}
