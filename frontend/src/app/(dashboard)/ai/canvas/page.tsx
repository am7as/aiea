import { TopBar } from "@/components/TopBar";
import { api, type Course } from "@/lib/api";
import { CoursePipelineCanvas } from "./CoursePipelineCanvas";

export const dynamic = "force-dynamic";

async function loadCourses(): Promise<Course[]> {
  try {
    return await api<Course[]>("/courses/");
  } catch {
    return [];
  }
}

export default async function CanvasPage() {
  const courses = await loadCourses();
  return (
    <>
      <TopBar
        title="Canvas — Course pipeline"
        subtitle="Live visualisation of each course's data flow: materials → extractions → chapters → harvested + AI-generated questions → exams. Click any node to jump to its panel."
      />
      <CoursePipelineCanvas courses={courses} />
    </>
  );
}
