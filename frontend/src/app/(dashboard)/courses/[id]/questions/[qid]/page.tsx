import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { TopBar } from "@/components/TopBar";
import { api, ApiError, getQuestion, type Course, type Question } from "@/lib/api";
import { QuestionDetailPanel } from "./QuestionDetailPanel";

export const dynamic = "force-dynamic";

export default async function QuestionDetailPage({
  params,
}: {
  params: Promise<{ id: string; qid: string }>;
}) {
  const { id, qid } = await params;

  let course: Course;
  let question: Question;
  try {
    [course, question] = await Promise.all([
      api<Course>(`/courses/${id}`),
      getQuestion(qid),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <>
      <Link
        href={`/courses/${id}/questions`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {course.code} questions
      </Link>

      <TopBar
        title="Question detail"
        subtitle={`${course.code} — review prompt, answer, and evaluation`}
      />

      <div className="mt-6">
        <QuestionDetailPanel courseId={id} courseCode={course.code} initial={question} />
      </div>
    </>
  );
}
