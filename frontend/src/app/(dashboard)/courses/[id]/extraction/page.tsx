import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { TopBar } from "@/components/TopBar";
import { api, ApiError, listMaterials, type Course } from "@/lib/api";
import { ExtractionTable } from "./ExtractionTable";

export const dynamic = "force-dynamic";

export default async function ExtractionPage({
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
  const materials = await listMaterials(id);

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
        title="Extraction inventory"
        subtitle={`${course.code} — what has been extracted, and where it is stored`}
      />

      <div className="mt-6">
        <ExtractionTable course={course} materials={materials} />
      </div>
    </>
  );
}
