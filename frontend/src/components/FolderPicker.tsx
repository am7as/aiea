"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Folder, FolderPlus, Home, X } from "lucide-react";

import { ApiError, fsList, fsMkdir, fsRoots, type FsListing } from "@/lib/api";
import { cn } from "@/lib/cn";

type Props = {
  open: boolean;
  initialPath?: string | null;
  title?: string;
  onClose: () => void;
  onPick: (path: string) => void;
};

export function FolderPicker({ open, initialPath, title, onClose, onPick }: Props) {
  const [roots, setRoots] = useState<string[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const r = await fsRoots();
        setRoots(r.roots);
        await load(initialPath || r.default);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Failed to load roots");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function load(target: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const r = await fsList(target);
      setListing(r);
      setPath(r.path);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to list");
    } finally {
      setLoading(false);
    }
  }

  async function makeSub() {
    if (!path || !newName.trim()) return;
    const sep = path.endsWith("/") ? "" : "/";
    const target = `${path}${sep}${newName.trim()}`;
    setCreating(true);
    try {
      await fsMkdir(target);
      setNewName("");
      await load(path);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Mkdir failed");
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  const breadcrumbs = path ? renderBreadcrumbs(path, roots) : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">{title ?? "Pick a folder"}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Click a folder to drill in. Pick the one you want at the bottom.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2 flex-wrap text-xs font-mono">
          <RootSwitcher roots={roots} current={path} onPick={(p) => load(p)} />
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-slate-600" />
              <button
                type="button"
                onClick={() => load(b.path)}
                className={cn(
                  "px-1.5 py-0.5 rounded hover:bg-slate-800",
                  i === breadcrumbs.length - 1 ? "text-slate-100" : "text-slate-400",
                )}
              >
                {b.name}
              </button>
            </span>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-4 min-h-[200px]">
          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300 mb-3">
              {error}
            </div>
          )}
          {loading ? (
            <div className="text-sm text-slate-500">Loading…</div>
          ) : listing ? (
            <>
              {listing.parent && (
                <button
                  type="button"
                  onClick={() => listing.parent && load(listing.parent)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-900 text-slate-400 text-sm"
                >
                  <Folder className="h-4 w-4" />
                  <span className="font-mono">..</span>
                </button>
              )}
              {listing.folders.length === 0 ? (
                <div className="text-sm text-slate-500 italic px-3 py-2">No subfolders here.</div>
              ) : (
                <ul className="space-y-0.5">
                  {listing.folders.map((f) => (
                    <li key={f.path}>
                      <button
                        type="button"
                        onDoubleClick={() => load(f.path)}
                        onClick={() => load(f.path)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-900 text-slate-200 text-sm text-left"
                      >
                        <Folder className="h-4 w-4 text-blue-400 shrink-0" />
                        <span className="font-mono truncate">{f.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {listing.file_count > 0 && (
                <div className="mt-3 text-[11px] text-slate-500 px-3">
                  + {listing.file_count} file{listing.file_count === 1 ? "" : "s"} in this folder
                </div>
              )}
            </>
          ) : null}
        </div>

        <div className="border-t border-slate-800 p-3 flex items-center gap-2">
          <input
            type="text"
            placeholder="New subfolder name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void makeSub();
            }}
            className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={makeSub}
            disabled={creating || !newName.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs disabled:opacity-50"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Create
          </button>
        </div>

        <div className="border-t border-slate-800 px-5 py-3 flex items-center justify-between gap-3 bg-slate-950">
          <div className="text-xs text-slate-400 font-mono truncate">{path ?? "—"}</div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => path && onPick(path)}
              disabled={!path}
              className="px-4 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-medium"
            >
              Pick this folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RootSwitcher({
  roots,
  current,
  onPick,
}: {
  roots: string[];
  current: string | null;
  onPick: (p: string) => void;
}) {
  if (roots.length === 0) return null;
  return (
    <div className="inline-flex items-center gap-1">
      <Home className="h-3.5 w-3.5 text-slate-500" />
      {roots.map((r) => {
        const isActive = current?.startsWith(r) ?? false;
        const name = r.split("/").pop() || r;
        return (
          <button
            key={r}
            type="button"
            onClick={() => onPick(r)}
            className={cn(
              "px-2 py-0.5 rounded text-[11px] hover:bg-slate-800",
              isActive ? "bg-slate-800 text-blue-300" : "text-slate-400",
            )}
            title={r}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}

function renderBreadcrumbs(path: string, roots: string[]): { name: string; path: string }[] {
  const matchedRoot = roots.find((r) => path === r || path.startsWith(r + "/"));
  if (!matchedRoot) {
    return path.split("/").filter(Boolean).map((seg, i, all) => ({
      name: seg,
      path: "/" + all.slice(0, i + 1).join("/"),
    }));
  }
  const tail = path === matchedRoot ? "" : path.slice(matchedRoot.length + 1);
  const segs = tail ? tail.split("/") : [];
  let acc = matchedRoot;
  const crumbs: { name: string; path: string }[] = [];
  for (const seg of segs) {
    acc = `${acc}/${seg}`;
    crumbs.push({ name: seg, path: acc });
  }
  return crumbs;
}
