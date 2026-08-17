import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { TopBar } from "@/components/TopBar";
import { api, ApiError, getSyllabus, type Course, type Syllabus } from "@/lib/api";
import { SyllabusPanel } from "./SyllabusPanel";

export const dynamic = "force-dynamic";

const EMPTY: Syllabus = {
  exists: false,
  content: "",
  chapters: [],
  elos: [],
  body: "",
  status: "none",
  error: null,
  updated_at: null,
};

export default async function SyllabusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let course: Course;
  try {
    course = await api<Course>(`/courses/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  let syllabus: Syllabus = EMPTY;
  let brainMissing = false;
  try {
    syllabus = await getSyllabus(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) brainMissing = true;
    else throw err;
  }

  return (
    <>
      <Link
        href={`/courses/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {course.code}
      </Link>

      <TopBar
        title="Course Map"
        subtitle={`${course.code} — chapter coverage, exam emphasis and expected learning outcomes`}
      />

      <div className="mt-6">
        {brainMissing ? (
          <div className="rounded-2xl border border-amber-700/50 bg-amber-500/5 p-6 text-sm text-amber-200/90">
            This course has no <span className="font-mono">brain/</span> folder configured. Connect
            one in the workspace — the syllabus is stored at{" "}
            <span className="font-mono">brain/syllabus.md</span>.
          </div>
        ) : (
          <SyllabusPanel courseId={id} initial={syllabus} />
        )}
      </div>
    </>
  );
}
