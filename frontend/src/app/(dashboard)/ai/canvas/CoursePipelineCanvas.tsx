"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Boxes,
  BookOpen,
  GraduationCap,
  Library,
  Bot,
  Archive,
  Loader2,
  ChevronRight,
  Activity,
  ExternalLink,
  X,
} from "lucide-react";

import {
  ApiError,
  api,
  listExams,
  listMaterials,
  listQuestions,
  listTasks,
  type Course,
  type Material,
  type Question,
  type ExamSummary,
  type Syllabus,
  type TasksSnapshot,
} from "@/lib/api";

// ── per-course pipeline data ────────────────────────────────────────────────

type Pipeline = {
  materials: { total: number; extracted: number; list: Material[] };
  syllabus: {
    chapters: number;
    elos: number;
    categories: number;
    raw: Syllabus | null;
  };
  questions: Question[];
  exams: ExamSummary[];
};

async function loadPipeline(courseId: string): Promise<Pipeline> {
  const [mats, qs, exs, syll] = await Promise.all([
    listMaterials(courseId),
    listQuestions(courseId),
    listExams(courseId),
    api<Syllabus>(`/courses/${courseId}/syllabus`).catch(() => null),
  ]);
  const extracted = (mats as Material[]).filter((m) => m.extraction_status === "done").length;
  const categories = (syll?.chapters ?? []).reduce(
    (sum, c) => sum + (c.categories?.length ?? 0),
    0,
  );
  return {
    materials: { total: mats.length, extracted, list: mats },
    syllabus: {
      chapters: (syll?.chapters ?? []).length,
      elos: (syll?.elos ?? []).length,
      categories,
      raw: syll,
    },
    questions: qs,
    exams: exs,
  };
}

// Heuristic: tag a job to a pipeline node based on its function name.
function nodeForTask(taskName: string): NodeId | null {
  if (taskName === "ingest_material" || taskName === "ai_extract_material") return "materials";
  if (taskName === "build_syllabus" || taskName === "discover_categories_job") return "syllabus";
  if (taskName === "harvest_questions_job") return "harvested";
  if (
    taskName === "generate_questions" ||
    taskName === "find_answer_job" ||
    taskName === "evaluate_question_job" ||
    taskName === "feedback_question_job" ||
    taskName === "classify_question_job" ||
    taskName === "similarity_question_job"
  )
    return "generated";
  if (taskName === "render_exam" || taskName === "compile_exam_pdf") return "examsGen";
  return null;
}

type NodeId =
  | "materials"
  | "syllabus"
  | "harvested"
  | "generated"
  | "examsRef"
  | "examsGen";

// ── custom node ─────────────────────────────────────────────────────────────

type NodeData = {
  id: NodeId;
  icon: typeof Boxes;
  title: string;
  count: number;
  caption: string;
  accent: string;
  href: string;
  busy: number;
  selected: boolean;
  onSelect: (id: NodeId) => void;
};

function PipelineNode({ data }: NodeProps<Node<NodeData>>) {
  const router = useRouter();
  const Icon = data.icon;
  return (
    <div
      onClick={(ev) => {
        if (ev.shiftKey || ev.metaKey) router.push(data.href);
        else data.onSelect(data.id);
      }}
      className={`group min-w-[220px] cursor-pointer rounded-2xl border bg-slate-900/85 px-4 py-3 backdrop-blur transition hover:bg-slate-900 ${data.accent} ${
        data.selected ? "ring-2 ring-blue-500/60" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-slate-500" />
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span className="text-sm font-semibold text-slate-100">{data.title}</span>
        <div className="flex-1" />
        {data.busy > 0 && (
          <span
            title={`${data.busy} live AI task${data.busy === 1 ? "" : "s"}`}
            className="inline-flex items-center gap-1 rounded-full border border-blue-700/60 bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-200"
          >
            <Activity className="h-2.5 w-2.5 animate-pulse" />
            {data.busy}
          </span>
        )}
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] tabular-nums text-slate-200">
          {data.count}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-slate-400">{data.caption}</div>
      <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-500 opacity-0 transition group-hover:opacity-100">
        Click to inspect · shift+click to open panel <ChevronRight className="h-3 w-3" />
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-slate-500" />
    </div>
  );
}

const NODE_TYPES = { pipe: PipelineNode };

// ── layout ──────────────────────────────────────────────────────────────────

function buildGraph(
  courseId: string,
  p: Pipeline,
  busyByNode: Partial<Record<NodeId, number>>,
  selected: NodeId | null,
  onSelect: (id: NodeId) => void,
): { nodes: Node[]; edges: Edge[] } {
  const X1 = 40, X2 = 320, X3 = 600, X4 = 880;
  const TOP = 80, BOTTOM = 260;
  const c = (path: string) => `/courses/${courseId}${path}`;
  const harvestedCount = p.questions.filter((q) => q.origin === "harvested").length;
  const generatedCount = p.questions.length - harvestedCount;
  const examsRefCount = p.exams.filter((e) => e.origin === "reference").length;
  const examsGenCount = p.exams.length - examsRefCount;

  const mkNode = (
    id: NodeId,
    x: number,
    y: number,
    base: Omit<NodeData, "id" | "busy" | "selected" | "onSelect">,
  ): Node => ({
    id,
    type: "pipe",
    position: { x, y },
    data: {
      ...base,
      id,
      busy: busyByNode[id] ?? 0,
      selected: selected === id,
      onSelect,
    },
  });

  const nodes: Node[] = [
    mkNode("materials", X1, TOP + 60, {
      icon: Boxes,
      title: "Materials",
      count: p.materials.total,
      caption: `${p.materials.extracted} extracted · drop files in materials/`,
      accent: "border-slate-700",
      href: c("/extraction"),
    }),
    mkNode("syllabus", X2, TOP + 60, {
      icon: GraduationCap,
      title: "Course Map",
      count: p.syllabus.chapters,
      caption: `${p.syllabus.elos} ELOs · ${p.syllabus.categories} categories`,
      accent: "border-violet-700/50",
      href: c("/syllabus"),
    }),
    mkNode("harvested", X3, TOP, {
      icon: BookOpen,
      title: "Harvested",
      count: harvestedCount,
      caption: "Reference questions from past exams",
      accent: "border-amber-700/50",
      href: c("/questions?origin=harvested"),
    }),
    mkNode("generated", X3, BOTTOM, {
      icon: Bot,
      title: "AI generated",
      count: generatedCount,
      caption: "From the Generation panel",
      accent: "border-blue-700/50",
      href: c("/exam-plan"),
    }),
    mkNode("examsRef", X4, TOP, {
      icon: Library,
      title: "Reference exams",
      count: examsRefCount,
      caption: "Past exams imported as Exam rows",
      accent: "border-amber-700/50",
      href: c("/exam-bank"),
    }),
    mkNode("examsGen", X4, BOTTOM, {
      icon: Archive,
      title: "Generated exams",
      count: examsGenCount,
      caption: "Auto blueprint or manual picker",
      accent: "border-blue-700/50",
      href: c("/exam-builder"),
    }),
  ];

  const edges: Edge[] = [
    { id: "m-s", source: "materials", target: "syllabus", animated: true, style: { stroke: "#a78bfa" } },
    { id: "s-h", source: "syllabus", target: "harvested", style: { stroke: "#fbbf24" } },
    { id: "s-g", source: "syllabus", target: "generated", style: { stroke: "#60a5fa" } },
    { id: "h-er", source: "harvested", target: "examsRef", animated: true, style: { stroke: "#fbbf24" } },
    { id: "g-eg", source: "generated", target: "examsGen", animated: true, style: { stroke: "#60a5fa" } },
    { id: "h-eg", source: "harvested", target: "examsGen", style: { stroke: "#94a3b8", strokeDasharray: "4 2" } },
  ];

  return { nodes, edges };
}

// ── component ───────────────────────────────────────────────────────────────

export function CoursePipelineCanvas({ courses }: { courses: Course[] }) {
  const [courseId, setCourseId] = useState<string>(courses[0]?.id ?? "");
  const [pipe, setPipe] = useState<Pipeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TasksSnapshot | null>(null);
  const [selected, setSelected] = useState<NodeId | null>(null);

  useEffect(() => {
    if (!courseId) return;
    setLoading(true);
    setErr(null);
    loadPipeline(courseId)
      .then(setPipe)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "failed to load pipeline"))
      .finally(() => setLoading(false));
  }, [courseId]);

  // Poll live task state every 4s so the in-flight badges stay fresh.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const t = await listTasks();
        if (alive) setTasks(t);
      } catch {
        /* keep stale */
      }
    };
    void tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const busyByNode = useMemo(() => {
    const out: Partial<Record<NodeId, number>> = {};
    if (!tasks) return out;
    for (const t of [...tasks.in_progress, ...tasks.queued]) {
      const n = nodeForTask(t.name);
      if (n) out[n] = (out[n] ?? 0) + 1;
    }
    return out;
  }, [tasks]);

  const onSelect = useCallback((id: NodeId) => {
    setSelected((cur) => (cur === id ? null : id));
  }, []);

  const graph = useMemo(
    () => (pipe ? buildGraph(courseId, pipe, busyByNode, selected, onSelect) : null),
    [courseId, pipe, busyByNode, selected, onSelect],
  );

  if (courses.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center text-sm text-slate-400">
        No courses yet — create one under Courses to see its pipeline.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-xs text-slate-500">Course</label>
        <select
          value={courseId}
          onChange={(e) => {
            setCourseId(e.target.value);
            setSelected(null);
          }}
          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.title}
            </option>
          ))}
        </select>
        {loading && (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading pipeline…
          </span>
        )}
        {tasks && (tasks.counts.in_progress + tasks.counts.queued > 0) && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-700/60 bg-blue-500/15 px-2 py-0.5 text-[11px] text-blue-200">
            <Activity className="h-3 w-3 animate-pulse" />
            {tasks.counts.in_progress + tasks.counts.queued} AI task(s) live
          </span>
        )}
        {err && <span className="text-xs text-red-300">{err}</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="h-[560px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
          {graph && (
            <ReactFlow
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={NODE_TYPES}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              proOptions={{ hideAttribution: true }}
              nodesDraggable={false}
              nodesConnectable={false}
            >
              <Background color="#1e293b" gap={20} />
              <Controls className="!border-slate-700 !bg-slate-900" />
            </ReactFlow>
          )}
        </div>

        {/* Inspector */}
        <div className="h-[560px] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          {!selected || !pipe ? (
            <div className="grid h-full place-items-center text-center">
              <div className="max-w-xs text-xs text-slate-500">
                <p>Click a node to inspect its content here.</p>
                <p className="mt-2 text-[11px] text-slate-600">
                  Shift- / Cmd-click a node to open its panel directly.
                </p>
              </div>
            </div>
          ) : (
            <Inspector
              node={selected}
              pipe={pipe}
              courseId={courseId}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Inspector({
  node,
  pipe,
  courseId,
  onClose,
}: {
  node: NodeId;
  pipe: Pipeline;
  courseId: string;
  onClose: () => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-100">
          {NODE_LABEL[node]}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={NODE_HREF(courseId)[node]}
            className="inline-flex items-center gap-1 text-[11px] text-blue-300 hover:text-blue-200"
          >
            Open panel <ExternalLink className="h-3 w-3" />
          </Link>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {node === "materials" && (
        <ItemList
          items={pipe.materials.list.map((m) => ({
            id: m.id,
            title: m.title || m.original_filename,
            meta: `${m.collection} · ${m.extraction_status}`,
          }))}
          empty="No materials. Drop files into materials/ and run Scan + Ingest."
        />
      )}

      {node === "syllabus" && (
        <div className="space-y-2">
          {(pipe.syllabus.raw?.chapters ?? []).length === 0 ? (
            <Empty>No syllabus yet — Build from materials in Course Map.</Empty>
          ) : (
            (pipe.syllabus.raw?.chapters ?? []).map((c) => (
              <div
                key={c.id ?? c.title}
                className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2"
              >
                <div className="text-xs font-semibold text-slate-200">
                  <span className="font-mono text-slate-500">{c.id}</span> {c.title}
                </div>
                <div className="mt-1 text-[10px] text-slate-500">
                  {c.elos?.length ?? 0} ELOs · {c.categories?.length ?? 0} categories
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {(node === "harvested" || node === "generated") && (
        <ItemList
          items={pipe.questions
            .filter((q) =>
              node === "harvested" ? q.origin === "harvested" : q.origin !== "harvested",
            )
            .slice(0, 60)
            .map((q) => ({
              id: q.id,
              title: q.prompt_md?.slice(0, 90) ?? "(no prompt)",
              meta: `${q.kind} · ${q.category ?? "uncategorized"}${
                q.difficulty ? ` · D${q.difficulty}` : ""
              }`,
              href: `/courses/${courseId}/questions/${q.id}`,
            }))}
          empty={
            node === "harvested"
              ? "No harvested questions — Harvest from materials/exams."
              : "No AI-generated questions yet — open Question Generation."
          }
        />
      )}

      {(node === "examsRef" || node === "examsGen") && (
        <ItemList
          items={pipe.exams
            .filter((e) =>
              node === "examsRef" ? e.origin === "reference" : e.origin !== "reference",
            )
            .map((e) => ({
              id: e.id,
              title: e.title,
              meta: `${e.question_count} questions · ${e.total_minutes} min · ${e.status}`,
              href: `/courses/${courseId}/exam-bank`,
            }))}
          empty={
            node === "examsRef"
              ? "No reference exams yet — Import reference exams in Exam Bank."
              : "No generated exams yet — Build one in Exam Builder."
          }
        />
      )}
    </div>
  );
}

const NODE_LABEL: Record<NodeId, string> = {
  materials: "Materials",
  syllabus: "Course Map — chapters",
  harvested: "Harvested questions",
  generated: "AI-generated questions",
  examsRef: "Reference exams",
  examsGen: "Generated exams",
};

const NODE_HREF = (courseId: string): Record<NodeId, string> => ({
  materials: `/courses/${courseId}/extraction`,
  syllabus: `/courses/${courseId}/syllabus`,
  harvested: `/courses/${courseId}/questions?origin=harvested`,
  generated: `/courses/${courseId}/exam-plan`,
  examsRef: `/courses/${courseId}/exam-bank`,
  examsGen: `/courses/${courseId}/exam-builder`,
});

function ItemList({
  items,
  empty,
}: {
  items: { id: string; title: string; meta: string; href?: string }[];
  empty: string;
}) {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="space-y-1.5">
      {items.map((it) => {
        const inner = (
          <>
            <div className="truncate text-xs text-slate-200">{it.title}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">{it.meta}</div>
          </>
        );
        return it.href ? (
          <Link
            key={it.id}
            href={it.href}
            className="block rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 transition hover:border-slate-700 hover:bg-slate-900/60"
          >
            {inner}
          </Link>
        ) : (
          <div
            key={it.id}
            className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2"
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/30 px-3 py-6 text-center text-xs text-slate-500">
      {children}
    </div>
  );
}
