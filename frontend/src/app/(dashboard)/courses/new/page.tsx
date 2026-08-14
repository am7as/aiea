"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, FolderOpen } from "lucide-react";

import { TopBar } from "@/components/TopBar";
import { FolderPicker } from "@/components/FolderPicker";
import { api, ApiError, type Course, type CourseCreate } from "@/lib/api";

type Mode = "quick" | "custom";

export default function NewCoursePage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("quick");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("");
  const [description, setDescription] = useState("");
  const [topicsText, setTopicsText] = useState("");

  // Quick mode
  const [quickParent, setQuickParent] = useState("");

  // Custom mode
  const [materialsPath, setMaterialsPath] = useState("");
  const [brainPath, setBrainPath] = useState("");
  const [libraryPath, setLibraryPath] = useState("");
  const [workshopPath, setWorkshopPath] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Folder picker state — single open picker that knows which field it targets
  const [pickerOpen, setPickerOpen] = useState<null | "quick" | "materials" | "brain" | "library" | "workshop">(null);
  function applyPicked(picked: string) {
    if (pickerOpen === "quick") setQuickParent(picked);
    if (pickerOpen === "materials") setMaterialsPath(picked);
    if (pickerOpen === "brain") setBrainPath(picked);
    if (pickerOpen === "library") setLibraryPath(picked);
    if (pickerOpen === "workshop") setWorkshopPath(picked);
    setPickerOpen(null);
  }
  const pickerInitial =
    pickerOpen === "quick" ? quickParent :
    pickerOpen === "materials" ? materialsPath :
    pickerOpen === "brain" ? brainPath :
    pickerOpen === "library" ? libraryPath :
    pickerOpen === "workshop" ? workshopPath :
    "";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const payload: CourseCreate = {
      code: code.trim(),
      title: title.trim(),
      description_md: description,
      language: language.trim() || null,
      topics: topicsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };
    if (mode === "quick") {
      payload.quick_parent = quickParent.trim();
    } else {
      payload.materials_path = materialsPath.trim();
      payload.brain_path = brainPath.trim();
      payload.library_path = libraryPath.trim();
      payload.workshop_path = workshopPath.trim();
    }
    try {
      const created = await api<Course>("/courses/", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      router.push(`/courses/${created.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create course");
      setSubmitting(false);
    }
  }

  const quickPreview = quickParent
    ? {
        materials: `${quickParent.replace(/\/$/, "")}/materials`,
        brain: `${quickParent.replace(/\/$/, "")}/brain`,
        library: `${quickParent.replace(/\/$/, "")}/library`,
        workshop: `${quickParent.replace(/\/$/, "")}/workshop`,
      }
    : null;

  return (
    <>
      <Link
        href="/courses"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to courses
      </Link>
      <TopBar title="New course" subtitle="Two configurable paths per course; AIEA scaffolds the subfolder layout inside." />

      <form
        onSubmit={onSubmit}
        className="max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1 sm:col-span-1">
            <label htmlFor="code" className="text-xs text-slate-500">Code</label>
            <input
              id="code"
              type="text"
              required
              maxLength={64}
              autoFocus
              placeholder="SSY300"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="block w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="title" className="text-xs text-slate-500">Title</label>
            <input
              id="title"
              type="text"
              required
              maxLength={256}
              placeholder="Applied Mechatronics"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="block w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1 sm:col-span-1">
            <label htmlFor="language" className="text-xs text-slate-500">Language code</label>
            <input
              id="language"
              type="text"
              maxLength={8}
              placeholder="en, sv, fa, ..."
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="block w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="topics" className="text-xs text-slate-500">
              Topics <span className="text-slate-600">(comma-separated)</span>
            </label>
            <input
              id="topics"
              type="text"
              placeholder="DC, AC, sensors, digital"
              value={topicsText}
              onChange={(e) => setTopicsText(e.target.value)}
              className="block w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="description" className="text-xs text-slate-500">
            Description <span className="text-slate-600">(Markdown)</span>
          </label>
          <textarea
            id="description"
            rows={4}
            placeholder="What this course covers. Used as AI context when generating questions."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="block w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="border-t border-slate-800/80 pt-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-slate-200">Folder layout</div>
              <div className="text-xs text-slate-500">
                AIEA creates the canonical subfolders inside each. Idempotent — safe to point at existing folders.
              </div>
            </div>
            <div className="inline-flex rounded-xl bg-slate-900 border border-slate-800 p-1 text-xs">
              <button
                type="button"
                onClick={() => setMode("quick")}
                className={`px-3 py-1 rounded-lg ${mode === "quick" ? "bg-blue-500 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                Quick (1 parent)
              </button>
              <button
                type="button"
                onClick={() => setMode("custom")}
                className={`px-3 py-1 rounded-lg ${mode === "custom" ? "bg-blue-500 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                Custom (4 paths)
              </button>
            </div>
          </div>

          {mode === "quick" ? (
            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="quick" className="text-xs text-slate-500">
                  Parent folder
                </label>
                <div className="flex items-stretch gap-2">
                  <input
                    id="quick"
                    type="text"
                    required
                    placeholder="/Users/yourname/aiea/SSY300"
                    value={quickParent}
                    onChange={(e) => setQuickParent(e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setPickerOpen("quick")}
                    className="inline-flex items-center gap-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Browse
                  </button>
                </div>
              </div>
              {quickPreview && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 font-mono text-xs text-slate-400 space-y-0.5">
                  <div>📂 {quickPreview.materials}</div>
                  <div>🧠 {quickPreview.brain}</div>
                  <div>📚 {quickPreview.library}</div>
                  <div>🛠 {quickPreview.workshop}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {([
                { id: "materials_path", key: "materials" as const, label: "Materials — your reference course material", value: materialsPath, set: setMaterialsPath, ph: "/Users/yourname/Downloads/SSY300-..." },
                { id: "brain_path", key: "brain" as const, label: "Brain — skills, agents, hooks, memory", value: brainPath, set: setBrainPath, ph: "/Users/yourname/aiea/SSY300/brain" },
                { id: "library_path", key: "library" as const, label: "Library — final clean outputs", value: libraryPath, set: setLibraryPath, ph: "/Users/yourname/aiea/SSY300/library" },
                { id: "workshop_path", key: "workshop" as const, label: "Workshop — drafts, chats, extracted", value: workshopPath, set: setWorkshopPath, ph: "/Users/yourname/aiea/SSY300/workshop" },
              ]).map((f) => (
                <div key={f.id} className="flex flex-col gap-1">
                  <label htmlFor={f.id} className="text-xs text-slate-500">{f.label}</label>
                  <div className="flex items-stretch gap-2">
                    <input
                      id={f.id}
                      type="text"
                      required
                      placeholder={f.ph}
                      value={f.value}
                      onChange={(e) => f.set(e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setPickerOpen(f.key)}
                      className="inline-flex items-center gap-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      Browse
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <FolderPicker
          open={pickerOpen !== null}
          initialPath={pickerInitial}
          title={
            pickerOpen === "quick" ? "Pick parent folder for the course" :
            pickerOpen ? `Pick ${pickerOpen} folder` : ""
          }
          onClose={() => setPickerOpen(null)}
          onPick={applyPicked}
        />

        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-slate-800/80 pt-5">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {submitting ? "Creating…" : "Create course"}
          </button>
          <Link href="/courses" className="text-sm text-slate-400 hover:text-slate-200">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
