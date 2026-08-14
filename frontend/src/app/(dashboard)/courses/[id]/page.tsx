import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  FileText,
  HelpCircle,
  ClipboardList,
  Calendar,
  FolderOpen,
  Brain,
  BookMarked,
  Hammer,
  Boxes,
  GraduationCap,
  ChevronRight,
} from "lucide-react";

import { TopBar } from "@/components/TopBar";
import { api, ApiError, type Course } from "@/lib/api";
import { DeleteCourseButton } from "./DeleteCourseButton";
import { ScanPanel } from "./ScanPanel";

export const dynamic = "force-dynamic";

async function loadCourse(id: string): Promise<Course> {
  try {
    return await api<Course>(`/courses/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const course = await loadCourse(id);
  const created = new Date(course.created_at);

  return (
    <>
      <Link
        href="/courses"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to courses
      </Link>

      <TopBar
        title={course.title}
        subtitle={`${course.code}${course.language ? ` · ${course.language}` : ""}`}
        action={<DeleteCourseButton id={course.id} title={course.title} />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2 space-y-6">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Folders</h2>
            <div className="space-y-2 font-mono text-xs">
              <PathRow icon={FolderOpen} label="materials" path={course.materials_path} accent="text-blue-400" />
              <PathRow icon={Brain} label="brain" path={course.brain_path} accent="text-violet-400" />
              <PathRow icon={BookMarked} label="library" path={course.library_path} accent="text-green-400" />
              <PathRow icon={Hammer} label="workshop" path={course.workshop_path} accent="text-amber-400" />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Description</h2>
            {course.description_md ? (
              <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
                {course.description_md}
              </pre>
            ) : (
              <p className="text-sm text-slate-500 italic">No description yet.</p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Topics</h2>
            {course.topics.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No topics yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {course.topics.map((t) => (
                  <span key={t} className="px-3 py-1 rounded-full bg-slate-800/80 text-xs text-slate-200">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <Calendar className="h-3.5 w-3.5" />
              Created
            </div>
            <div className="text-sm text-slate-200">
              {created.toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>

          <StatCard icon={FileText} label="Materials" count={course.materials_count} hint="ingested" />
          <StatCard icon={HelpCircle} label="Questions" count={course.questions_count} hint="Phase 4" />
          <StatCard icon={ClipboardList} label="Exams" count={course.exams_count} hint="Phase 7" />
        </aside>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <ToolLink
          href={`/courses/${course.id}/extraction`}
          icon={Boxes}
          title="Extraction inventory"
          desc="What's extracted, by collection, and where it's stored"
          accent="text-blue-400"
        />
        <ToolLink
          href={`/courses/${course.id}/syllabus`}
          icon={GraduationCap}
          title="Syllabus"
          desc="AI-drafted chapters and expected learning outcomes"
          accent="text-violet-400"
        />
      </div>

      <ScanPanel courseId={course.id} materialsPath={course.materials_path} />
    </>
  );
}

function PathRow({
  icon: Icon,
  label,
  path,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  path: string | null;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${accent}`} />
      <span className={`w-20 ${accent}`}>{label}</span>
      <span className="text-slate-300 truncate">{path ?? <em className="text-slate-600">not set</em>}</span>
    </div>
  );
}

function ToolLink({
  href,
  icon: Icon,
  title,
  desc,
  accent,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  accent: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 hover:border-slate-700"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800/80">
        <Icon className={`h-5 w-5 ${accent}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-100">{title}</div>
        <div className="truncate text-xs text-slate-500">{desc}</div>
      </div>
      <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-slate-300" />
    </Link>
  );
}

function StatCard({
  icon: Icon,
  label,
  count,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-slate-800/80 text-slate-300 flex items-center justify-center">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm text-slate-300">{label}</div>
            <div className="text-[11px] text-slate-500">{hint}</div>
          </div>
        </div>
        <div className="text-2xl font-semibold text-slate-100 tabular-nums">{count}</div>
      </div>
    </div>
  );
}
