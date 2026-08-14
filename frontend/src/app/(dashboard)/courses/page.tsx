import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";

import { TopBar } from "@/components/TopBar";
import { api, type Course } from "@/lib/api";

export const dynamic = "force-dynamic";

async function loadCourses(): Promise<Course[]> {
  return api<Course[]>("/courses/");
}

export default async function CoursesPage() {
  const courses = await loadCourses();

  return (
    <>
      <TopBar
        title="Courses"
        subtitle="Top-level container for materials, questions, and exams."
        action={
          <Link
            href="/courses/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" />
            New course
          </Link>
        }
      />

      {courses.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center">
          <BookOpen className="h-8 w-8 text-slate-500 mx-auto mb-3" />
          <p className="text-slate-300 mb-2">No courses yet.</p>
          <p className="text-slate-500 text-sm mb-5">
            Each course holds its materials, questions, and assembled exams.
          </p>
          <Link
            href="/courses/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Create first course
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Title</th>
                <th className="px-5 py-3 font-medium">Topics</th>
                <th className="px-5 py-3 font-medium text-right">Materials</th>
                <th className="px-5 py-3 font-medium text-right">Questions</th>
                <th className="px-5 py-3 font-medium text-right">Exams</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {courses.map((c) => (
                <tr key={c.id} className="hover:bg-slate-900/40 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-slate-400">
                    <Link href={`/courses/${c.id}`}>{c.code}</Link>
                  </td>
                  <td className="px-5 py-3 text-slate-100">
                    <Link href={`/courses/${c.id}`} className="hover:text-blue-300">
                      {c.title}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.topics.slice(0, 4).map((t) => (
                        <span
                          key={t}
                          className="px-2 py-0.5 rounded-full bg-slate-800/80 text-[11px] text-slate-300"
                        >
                          {t}
                        </span>
                      ))}
                      {c.topics.length > 4 && (
                        <span className="text-[11px] text-slate-500">
                          +{c.topics.length - 4}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-slate-400 tabular-nums">
                    {c.materials_count}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-400 tabular-nums">
                    {c.questions_count}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-400 tabular-nums">
                    {c.exams_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
