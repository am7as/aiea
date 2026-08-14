"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";

import { api, type Course, type Material } from "@/lib/api";
import { cn } from "@/lib/cn";

function StatusPill({ status }: { status: Material["extraction_status"] }) {
  const styles: Record<Material["extraction_status"], string> = {
    pending: "bg-slate-800/80 text-slate-300",
    running: "bg-blue-500/15 text-blue-300",
    done: "bg-green-500/15 text-green-300",
    error: "bg-rose-500/15 text-rose-300",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", styles[status])}>
      {status}
    </span>
  );
}

export function MaterialsList({
  initial,
  courses,
}: {
  initial: Material[];
  courses: Map<string, Course>;
}) {
  const [materials, setMaterials] = useState<Material[]>(initial);
  const hasActive = materials.some(
    (m) => m.extraction_status === "pending" || m.extraction_status === "running",
  );

  useEffect(() => {
    if (!hasActive) return;
    const handle = window.setInterval(async () => {
      try {
        const next = await api<Material[]>("/materials/");
        setMaterials(next);
      } catch {
        /* ignore transient errors during poll */
      }
    }, 1500);
    return () => window.clearInterval(handle);
  }, [hasActive]);

  if (materials.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center">
        <FileText className="h-8 w-8 text-slate-500 mx-auto mb-3" />
        <p className="text-slate-300 mb-2">No materials registered yet.</p>
        <p className="text-slate-500 text-sm mb-5">
          Drop files into your course&apos;s <code className="text-slate-400">materials/</code> folder
          (book / lectures / exercises / exams / other), then open the course and click <em>Rescan</em>.
        </p>
        <Link
          href="/courses"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium"
        >
          Open courses
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
            <th className="px-5 py-3 font-medium">Title</th>
            <th className="px-5 py-3 font-medium">Course</th>
            <th className="px-5 py-3 font-medium">Collection</th>
            <th className="px-5 py-3 font-medium text-right">Pages</th>
            <th className="px-5 py-3 font-medium text-right">Words</th>
            <th className="px-5 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {materials.map((m) => {
            const course = courses.get(m.course_id);
            return (
              <tr key={m.id} className="hover:bg-slate-900/40 transition-colors">
                <td className="px-5 py-3 text-slate-100">
                  <div className="font-medium">{m.title}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{m.subpath}</div>
                  {m.extraction_error && (
                    <div className="text-[11px] text-rose-400 mt-1">{m.extraction_error}</div>
                  )}
                </td>
                <td className="px-5 py-3">
                  {course ? (
                    <Link
                      href={`/courses/${course.id}`}
                      className="text-xs font-mono text-slate-300 hover:text-blue-300"
                    >
                      {course.code}
                    </Link>
                  ) : (
                    <span className="text-xs text-slate-500">—</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <span className="px-2 py-0.5 rounded-full bg-slate-800/80 text-[11px] text-slate-300">
                    {m.collection}
                  </span>
                </td>
                <td className="px-5 py-3 text-right text-slate-400 tabular-nums">
                  {m.pages ?? "—"}
                </td>
                <td className="px-5 py-3 text-right text-slate-400 tabular-nums">
                  {m.word_count ?? "—"}
                </td>
                <td className="px-5 py-3">
                  <StatusPill status={m.extraction_status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
