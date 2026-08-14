import Link from "next/link";
import { FolderOpen, Plus } from "lucide-react";

import { TopBar } from "@/components/TopBar";
import { api, type Course } from "@/lib/api";
import { WorkspaceManager } from "./WorkspaceManager";

export const dynamic = "force-dynamic";

async function loadCourses(): Promise<Course[]> {
  try {
    return await api<Course[]>("/courses/");
  } catch {
    return [];
  }
}

export default async function WorkspacePage({
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
          title="Workspace"
          subtitle="Define the four folders for a course: materials, brain, library, workshop."
        />
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-16 text-center">
          <FolderOpen className="h-10 w-10 text-slate-500 mx-auto mb-4" />
          <p className="text-slate-300 mb-2 text-lg">No courses yet</p>
          <p className="text-slate-500 text-sm mb-6 max-w-md mx-auto">
            Create a course first, then come back here to set up its four folders.
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
  return <WorkspaceManager courses={courses} active={active} />;
}
