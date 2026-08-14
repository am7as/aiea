import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { TopBar } from "@/components/TopBar";
import {
  api,
  ApiError,
  listQuestions,
  type Course,
  type Question,
} from "@/lib/api";
import { QuestionsPanel } from "./QuestionsPanel";

export const dynamic = "force-dynamic";

export default async function QuestionsPage({
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

  const questions = (await listQuestions(id)) as Question[];

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
        title="Questions"
        subtitle={`${course.code} — review and curate exam questions`}
      />

      <div className="mt-6">
        <QuestionsPanel courseId={id} initialQuestions={questions} />
      </div>
    </>
  );
}
