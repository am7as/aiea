"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  ChevronDown,
  FolderOpen,
  Brain,
  BookMarked,
  Hammer,
  RefreshCw,
  Pencil,
  Check,
  X,
  FileText,
} from "lucide-react";

import { FolderPicker } from "@/components/FolderPicker";
import {
  ApiError,
  bootstrapCourse,
  previewParent,
  setupCourseFromParent,
  type Course,
  type CourseContents,
  type ParentPreview,
  type RoleContents,
  getCourseContents,
  scanCourse,
  updateCoursePaths,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { Wand2, Sparkles, Link2 } from "lucide-react";

type RoleKey = "materials" | "brain" | "library" | "workshop";

const ROLE_META: Record<
  RoleKey,
  {
    label: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    bg: string;
    pathField: "materials_path" | "brain_path" | "library_path" | "workshop_path";
  }
> = {
  materials: {
    label: "Materials",
    desc: "Your reference course material — you populate, AIEA reads",
    icon: FolderOpen,
    color: "text-blue-400",
    bg: "bg-blue-500/15",
    pathField: "materials_path",
  },
  brain: {
    label: "Brain",
    desc: "AI behavior & memory — you tune, AIEA reads on every prompt",
    icon: Brain,
    color: "text-violet-400",
    bg: "bg-violet-500/15",
    pathField: "brain_path",
  },
  library: {
    label: "Library",
    desc: "Final clean outputs — promoted from workshop",
    icon: BookMarked,
    color: "text-green-400",
    bg: "bg-green-500/15",
    pathField: "library_path",
  },
  workshop: {
    label: "Workshop",
    desc: "Interactive AI ↔ user space — drafts, chats, extracted, evaluations",
    icon: Hammer,
    color: "text-amber-400",
    bg: "bg-amber-500/15",
    pathField: "workshop_path",
  },
};

const ROLE_ORDER: RoleKey[] = ["materials", "brain", "library", "workshop"];

export function WorkspaceManager({ courses, active }: { courses: Course[]; active: Course }) {
  const router = useRouter();
  const [course, setCourse] = useState<Course>(active);
  const [contents, setContents] = useState<CourseContents | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialDone = useRef(false);

  useEffect(() => {
    setCourse(active);
    initialDone.current = false;
  }, [active]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const c = await getCourseContents(course.id);
      setContents(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load contents");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (initialDone.current) return;
    initialDone.current = true;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id]);

  async function onPathSave(
    field: keyof typeof course,
    newPath: string,
    scaffold = true,
  ): Promise<void> {
    const updated = await updateCoursePaths(course.id, { [field]: newPath }, scaffold);
    setCourse(updated);
    await refresh();
  }

  async function onRunMaterialsScan() {
    setRefreshing(true);
    try {
      await scanCourse(course.id, false);
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function onBootstrapRole(role: "materials" | "brain" | "library" | "workshop") {
    setRefreshing(true);
    try {
      const updated = await bootstrapCourse(course.id, role);
      setCourse(updated);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Scaffold failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function onSetupFromParent(parent: string, scaffold: boolean) {
    setRefreshing(true);
    try {
      const updated = await setupCourseFromParent(course.id, parent, scaffold);
      setCourse(updated);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Setup failed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <CourseSwitcher
            courses={courses}
            current={course}
            onChange={(c) => {
              router.push(`/workspace?course=${c.id}`);
            }}
          />
          <p className="text-sm text-slate-500 mt-2">
            {course.code} · {course.title}
            {course.language ? ` · ${course.language}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </button>
          <button
            type="button"
            onClick={onRunMaterialsScan}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
          >
            Rescan materials
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-start justify-between mb-4 gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Folders</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Four roots define this course&apos;s workspace. Edit any path to re-target — AIEA re-bootstraps the canonical subfolders on save.
            </p>
          </div>
          <SetupFromParentButton onSetup={onSetupFromParent} />
        </div>
        <div className="space-y-2">
          {ROLE_ORDER.map((role) => {
            const meta = ROLE_META[role];
            const path = course[meta.pathField];
            const roleData = contents?.[role];
            return (
              <FolderRow
                key={role}
                meta={meta}
                path={path}
                loading={!roleData}
                exists={roleData?.exists ?? false}
                fileCount={
                  roleData?.sections.reduce((a, s) => a + s.count, 0) ?? null
                }
                onSave={(p) => onPathSave(meta.pathField, p)}
              />
            );
          })}
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {error}
        </div>
      )}

      {contents &&
        ROLE_ORDER.map((role) => (
          <RolePanel
            key={role}
            role={role}
            data={contents[role]}
            courseId={course.id}
            onScaffold={() => onBootstrapRole(role)}
          />
        ))}
    </div>
  );
}

function SetupFromParentButton({
  onSetup,
}: {
  onSetup: (parent: string, scaffold: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ParentPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!open) {
      setParent("");
      setPreview(null);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!parent.trim()) {
      setPreview(null);
      return;
    }
    const t = window.setTimeout(async () => {
      setPreviewing(true);
      try {
        const p = await previewParent(parent.trim());
        setPreview(p);
      } catch {
        setPreview(null);
      } finally {
        setPreviewing(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [parent]);

  async function commit(scaffold: boolean) {
    if (!parent.trim()) return;
    setBusy(true);
    try {
      await onSetup(parent.trim(), scaffold);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const allFourExist =
    preview && (["materials", "brain", "library", "workshop"] as const).every(
      (r) => preview.subfolders[r].exists,
    );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 text-xs font-medium shrink-0"
        title="Pick one parent; AIEA either creates the four folders + subfolders inside it, or connects to existing ones"
      >
        <Wand2 className="h-3.5 w-3.5" />
        Set up / connect from one parent
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-auto">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Set up / connect from one parent</h3>
              <p className="text-[11px] text-slate-500 mt-1">
                Point at any parent folder. AIEA looks inside for{" "}
                <span className="font-mono">{`{materials, brain, library, workshop}`}</span> and offers two actions: connect to what&apos;s there, or create the missing pieces.
              </p>
            </div>
            <div className="flex items-stretch gap-2">
              <input
                type="text"
                autoFocus
                value={parent}
                onChange={(e) => setParent(e.target.value)}
                placeholder="/Users/yourname/aiea/SSY300"
                className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => setPicker(true)}
                className="inline-flex items-center gap-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Browse
              </button>
            </div>

            {previewing && <div className="text-xs text-slate-500">Looking inside…</div>}
            {preview && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-1">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                  Preview
                </div>
                {(["materials", "brain", "library", "workshop"] as const).map((role) => {
                  const info = preview.subfolders[role];
                  return (
                    <div key={role} className="flex items-center justify-between text-xs">
                      <span className={cn("font-mono", info.exists ? "text-slate-200" : "text-slate-500")}>
                        {role}/
                      </span>
                      {info.exists ? (
                        <span className="text-green-400">
                          {info.file_count ?? 0} files
                          {info.subfolders && info.subfolders.length > 0 &&
                            ` · ${info.subfolders.length} subfolders`}
                        </span>
                      ) : (
                        <span className="text-rose-400">missing</span>
                      )}
                    </div>
                  );
                })}
                {allFourExist && (
                  <div className="text-[11px] text-green-400 pt-1">
                    All four exist — &quot;Connect existing&quot; is safe.
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => commit(false)}
                disabled={busy || !parent.trim()}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-sm font-medium inline-flex items-center gap-2"
                title="Just set the four paths; do not create or modify anything on disk"
              >
                <Link2 className="h-3.5 w-3.5" />
                Connect existing
              </button>
              <button
                type="button"
                onClick={() => commit(true)}
                disabled={busy || !parent.trim()}
                className="px-4 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-2"
                title="Create the four folders + canonical subfolders inside parent (idempotent)"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {busy ? "…" : "Create & scaffold"}
              </button>
            </div>
          </div>
        </div>
      )}
      <FolderPicker
        open={picker}
        initialPath={parent || undefined}
        title="Pick a parent folder"
        onClose={() => setPicker(false)}
        onPick={(p) => {
          setParent(p);
          setPicker(false);
        }}
      />
    </>
  );
}

function CourseSwitcher({
  courses,
  current,
  onChange,
}: {
  courses: Course[];
  current: Course;
  onChange: (c: Course) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 group"
      >
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100 hover:text-blue-300">
          {current.title}
        </h1>
        <ChevronDown className="h-5 w-5 text-slate-500 group-hover:text-slate-300" />
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-80 rounded-xl border border-slate-800 bg-slate-900 shadow-xl">
          <ul className="py-1 max-h-72 overflow-auto">
            {courses.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onChange(c);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm hover:bg-slate-800",
                    c.id === current.id && "bg-slate-800/60 text-blue-300",
                  )}
                >
                  <div className="font-medium text-slate-100">{c.title}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{c.code}</div>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-800 p-2">
            <Link
              href="/courses/new"
              className="flex items-center gap-2 px-2 py-1.5 text-sm text-blue-400 hover:text-blue-300"
            >
              <Plus className="h-4 w-4" />
              New course
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function FolderRow({
  meta,
  path,
  loading,
  exists,
  fileCount,
  onSave,
}: {
  meta: (typeof ROLE_META)[RoleKey];
  path: string | null;
  loading: boolean;
  exists: boolean;
  fileCount: number | null;
  onSave: (p: string, scaffold: boolean) => Promise<void>;
}) {
  const Icon = meta.icon;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(path ?? "");
  const [scaffold, setScaffold] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  function startEdit() {
    setDraft(path ?? "");
    setScaffold(true);
    setEditing(true);
    setErr(null);
  }

  async function commitWith(p: string, doScaffold: boolean) {
    setBusy(true);
    try {
      await onSave(p, doScaffold);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!draft.trim() || draft === path) {
      setEditing(false);
      return;
    }
    await commitWith(draft.trim(), scaffold);
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 flex items-center gap-3",
        !loading && !exists && path && "border-rose-500/40 bg-rose-500/5",
      )}
    >
      <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", meta.bg, meta.color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn("text-sm font-medium", meta.color)}>{meta.label}</span>
          <span className="text-[11px] text-slate-500">{meta.desc}</span>
        </div>
        {editing ? (
          <div className="space-y-1.5 mt-1">
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commit();
                  if (e.key === "Escape") setEditing(false);
                }}
                className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500"
                placeholder="/absolute/path/to/folder"
              />
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                title="Browse"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={commit}
                disabled={busy}
                className="p-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50"
                title="Save"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                title="Cancel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-slate-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={scaffold}
                onChange={(e) => setScaffold(e.target.checked)}
                className="accent-blue-500"
              />
              also scaffold canonical subfolders inside this path (uncheck to just connect)
            </label>
          </div>
        ) : (
          <div className="text-xs font-mono text-slate-400 mt-0.5 truncate">
            {path ?? <em className="text-slate-600">not set</em>}
          </div>
        )}
        {err && <div className="text-[11px] text-rose-400 mt-1">{err}</div>}
      </div>
      <div className="shrink-0 flex items-center gap-3">
        {!loading && path && !exists && (
          <span className="text-[11px] text-rose-300 font-medium">missing</span>
        )}
        {fileCount !== null && (
          <span className="text-xs text-slate-400 tabular-nums">
            {fileCount} {fileCount === 1 ? "file" : "files"}
          </span>
        )}
        {!editing && (
          <>
            <button
              type="button"
              onClick={() => {
                startEdit();
                setPickerOpen(true);
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              title="Browse"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={startEdit}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              title="Edit path"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      <FolderPicker
        open={pickerOpen}
        initialPath={draft || path || undefined}
        title={`Pick ${meta.label.toLowerCase()} folder`}
        onClose={() => setPickerOpen(false)}
        onPick={(p) => {
          setDraft(p);
          setPickerOpen(false);
          void commitWith(p, scaffold);
        }}
      />
    </div>
  );
}

function RolePanel({
  role,
  data,
  courseId,
  onScaffold,
}: {
  role: RoleKey;
  data: RoleContents;
  courseId: string;
  onScaffold: () => Promise<void>;
}) {
  const meta = ROLE_META[role];
  const Icon = meta.icon;
  const total = useMemo(
    () => data.sections.reduce((a, s) => a + s.count, 0),
    [data.sections],
  );
  const noSections = data.exists && data.sections.length === 0;
  const [busy, setBusy] = useState(false);

  async function scaffold() {
    setBusy(true);
    try {
      await onScaffold();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex items-center justify-between mb-1 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", meta.bg, meta.color)}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className={cn("text-base font-semibold", meta.color)}>{meta.label}</h2>
            <p className="text-xs text-slate-500 truncate">{meta.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={scaffold}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-[11px] font-medium disabled:opacity-50"
            title={`Re-create the canonical subfolders inside the ${meta.label.toLowerCase()} folder`}
          >
            <Wand2 className="h-3 w-3" />
            {busy ? "Scaffolding…" : "Scaffold subfolders"}
          </button>
          <div className="text-xs text-slate-400 tabular-nums">
            {total} {total === 1 ? "file" : "files"}
          </div>
        </div>
      </div>

      {!data.exists ? (
        <div className="mt-4 rounded-xl border border-dashed border-rose-500/30 bg-rose-500/5 p-4 text-xs text-rose-300 flex items-center justify-between gap-3">
          <div>
            Folder does not exist yet. {data.path && <span className="font-mono">{data.path}</span>}
          </div>
          <button
            type="button"
            onClick={scaffold}
            disabled={busy}
            className="px-3 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[11px] font-medium disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0"
          >
            <Wand2 className="h-3 w-3" />
            Create now
          </button>
        </div>
      ) : noSections ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center">
          <FileText className="h-6 w-6 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-500">No canonical subfolders here yet.</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.sections.map((s) => (
            <SectionCard key={s.name} sectionName={s.name} count={s.count} files={s.files} courseId={courseId} role={role} />
          ))}
        </div>
      )}
    </section>
  );
}

function SectionCard({
  sectionName,
  count,
  files,
  courseId,
  role,
}: {
  sectionName: string;
  count: number;
  files: { name: string; relpath: string; size: number; ext: string }[];
  courseId: string;
  role: RoleKey;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = expanded ? files : files.slice(0, 5);
  const hidden = files.length - preview.length;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">{sectionName}</div>
        <div className="text-[11px] text-slate-400 tabular-nums">{count}</div>
      </div>
      {count === 0 ? (
        <div className="text-[11px] text-slate-600 italic">empty</div>
      ) : (
        <>
          <ul className="text-xs space-y-1">
            {preview.map((f) => (
              <li key={f.relpath} className="truncate text-slate-300 font-mono">
                {f.name}
                <span className="text-slate-600 ml-2">{Math.round(f.size / 1024)} KB</span>
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-2 text-[11px] text-blue-400 hover:text-blue-300"
            >
              +{hidden} more
            </button>
          )}
          {role === "materials" && (
            <Link
              href={`/courses/${courseId}`}
              className="block mt-2 text-[11px] text-blue-400 hover:text-blue-300"
            >
              Manage in course detail →
            </Link>
          )}
        </>
      )}
    </div>
  );
}
