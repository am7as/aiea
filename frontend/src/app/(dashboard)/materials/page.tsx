import Link from "next/link";
import { FileText } from "lucide-react";

import { TopBar } from "@/components/TopBar";
import { api, type Course, type Material } from "@/lib/api";
import { MaterialsList } from "./MaterialsList";

export const dynamic = "force-dynamic";

async function loadCourses(): Promise<Course[]> {
  try {
    return await api<Course[]>("/courses/");
  } catch {
    return [];
  }
}

async function loadMaterials(): Promise<Material[]> {
  try {
    return await api<Material[]>("/materials/");
  } catch {
    return [];
  }
}

export default async function MaterialsPage() {
  const [courses, materials] = await Promise.all([loadCourses(), loadMaterials()]);
  const courseById = new Map(courses.map((c) => [c.id, c]));

  return (
    <>
      <TopBar
        title="Materials"
        subtitle="Files registered across all courses. Drop files into a course's materials/ folder, then Rescan from the course page."
      />

      {courses.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center">
          <FileText className="h-8 w-8 text-slate-500 mx-auto mb-3" />
          <p className="text-slate-300 mb-2">Create a course first.</p>
          <p className="text-slate-500 text-sm mb-5">
            Materials hang off a course so they can be referenced when generating questions.
          </p>
          <Link
            href="/courses/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium"
          >
            New course
          </Link>
        </div>
      ) : (
        <MaterialsList initial={materials} courses={courseById} />
      )}
    </>
  );
}
