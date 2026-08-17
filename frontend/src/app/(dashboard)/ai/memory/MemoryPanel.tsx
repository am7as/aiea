"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  Hash,
  FileText,
  Database,
  Search,
  X,
  Filter,
} from "lucide-react";

import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import {
  memoryOverview,
  memoryReindex,
  memorySearch,
  memorySession,
  memorySessions,
  memoryTags,
  type MemoryOverview,
  type MemorySearchHit,
} from "@/lib/api";

type View =
  | { kind: "session"; name: string; markdown: string }
  | { kind: "search"; tags: string[]; hits: MemorySearchHit[] }
  | null;

export function MemoryPanel({
  overview,
  tags,
  sessions,
}: {
  overview: MemoryOverview;
  tags: Record<string, number>;
  sessions: string[];
}) {
  const [ov, setOv] = useState(overview);
  const [tagCounts, setTagCounts] = useState(tags);
  const [sessionList, setSessionList] = useState(sessions);
  const [view, setView] = useState<View>(null);
  const [reindexing, setReindexing] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);

  const reindex = useCallback(async () => {
    setReindexing(true);
    try {
      await memoryReindex();
      const [o, t, s] = await Promise.all([
        memoryOverview(),
        memoryTags(),
        memorySessions(),
      ]);
      setOv(o);
      setTagCounts(t);
      setSessionList(s);
    } catch {
      /* best-effort */
    } finally {
      setReindexing(false);
    }
  }, []);

  const openSession = useCallback(async (name: string) => {
    try {
      const s = await memorySession(name);
      const body = s.markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
      setView({ kind: "session", name, markdown: body });
    } catch {
      setView(null);
    }
  }, []);

  const runSearch = useCallback(async (tags: string[]) => {
    if (tags.length === 0) {
      setView(null);
      return;
    }
    const hits = await memorySearch(tags);
    setView({ kind: "search", tags, hits });
  }, []);

  function toggleTag(tag: string) {
    const next = activeTags.includes(tag)
      ? activeTags.filter((t) => t !== tag)
      : [...activeTags, tag];
    setActiveTags(next);
    void runSearch(next);
  }

  function clearTags() {
    setActiveTags([]);
    setView(null);
  }

  // Group tags by namespace and apply the search filter.
  const groups = useMemo(() => {
    const needle = tagFilter.trim().toLowerCase();
    const g: Record<string, [string, number][]> = {};
    for (const [tag, n] of Object.entries(tagCounts).sort()) {
      if (needle && !tag.toLowerCase().includes(needle)) continue;
      const ns = tag.split("/")[0];
      (g[ns] ??= []).push([tag, n]);
    }
    return g;
  }, [tagCounts, tagFilter]);

  const filteredSessions = useMemo(() => {
    const needle = sessionFilter.trim().toLowerCase();
    if (!needle) return sessionList;
    return sessionList.filter((s) => s.toLowerCase().includes(needle));
  }, [sessionList, sessionFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Stat icon={<FileText className="h-4 w-4" />} label="sessions" value={ov.sessions} />
        <Stat icon={<Hash className="h-4 w-4" />} label="exchanges" value={ov.headers} />
        <Stat icon={<Database className="h-4 w-4" />} label="distinct tags" value={ov.tag_count} />
        <span className="text-[11px] text-slate-500">
          root <span className="font-mono">{ov.root}</span>
        </span>
        {ov.generated && (
          <span className="text-[11px] text-slate-500">
            indexed {new Date(ov.generated).toLocaleString()}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={reindex}
          disabled={reindexing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-50"
        >
          {reindexing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Reindex
        </button>
      </div>

      {activeTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-blue-700/50 bg-blue-500/5 px-3 py-2">
          <Filter className="h-3.5 w-3.5 text-blue-300" />
          <span className="text-xs text-blue-200">Filter:</span>
          {activeTags.map((t) => (
            <button
              key={t}
              onClick={() => toggleTag(t)}
              className="inline-flex items-center gap-1 rounded-full border border-blue-700/60 bg-blue-500/15 px-2 py-0.5 font-mono text-[11px] text-blue-200 hover:bg-blue-500/25"
            >
              #{t}
              <X className="h-3 w-3" />
            </button>
          ))}
          <button
            onClick={clearTags}
            className="ml-2 text-[11px] text-slate-400 hover:text-slate-200"
          >
            Clear all
          </button>
        </div>
      )}

      {sessionList.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center">
          <p className="mb-1 text-slate-300">No memory yet.</p>
          <p className="text-sm text-slate-500">
            Open a provider&apos;s Console and chat — each exchange is logged here as tagged
            markdown.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
          {/* Left rail: tags + sessions */}
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Tags
                </div>
                <span className="text-[10px] text-slate-600">
                  {Object.values(groups).reduce((s, g) => s + g.length, 0)} shown
                </span>
              </div>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  placeholder="Filter tags…"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1 pl-7 pr-3 text-xs text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
              {Object.keys(groups).length === 0 && (
                <p className="text-xs text-slate-500">No tags match.</p>
              )}
              <div className="max-h-[360px] overflow-y-auto">
                {Object.entries(groups).map(([ns, items]) => (
                  <div key={ns} className="mb-3 last:mb-0">
                    <div className="mb-1 text-[11px] font-medium text-slate-400">{ns}</div>
                    <div className="flex flex-col gap-0.5">
                      {items.map(([tag, n]) => {
                        const on = activeTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            onClick={() => toggleTag(tag)}
                            className={`flex items-center justify-between rounded px-2 py-1 text-left text-xs transition ${
                              on
                                ? "bg-blue-500/20 text-blue-200"
                                : "text-slate-300 hover:bg-slate-800/60"
                            }`}
                          >
                            <span className="truncate font-mono">#{tag}</span>
                            <span className="ml-2 shrink-0 text-slate-500">{n}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Sessions
                </div>
                <span className="text-[10px] text-slate-600">{filteredSessions.length}</span>
              </div>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  value={sessionFilter}
                  onChange={(e) => setSessionFilter(e.target.value)}
                  placeholder="Filter sessions…"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1 pl-7 pr-3 text-xs text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="max-h-[280px] overflow-y-auto">
                <div className="flex flex-col gap-0.5">
                  {filteredSessions.map((s) => (
                    <button
                      key={s}
                      onClick={() => openSession(s)}
                      className={`truncate rounded px-2 py-1 text-left text-xs transition hover:bg-slate-800/60 ${
                        view?.kind === "session" && view.name === s
                          ? "bg-slate-800 text-blue-300"
                          : "text-slate-300"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right pane: detail */}
          <div className="min-h-[480px] rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            {view === null && (
              <div className="grid h-full place-items-center text-center">
                <div className="max-w-md text-sm text-slate-500">
                  <Hash className="mx-auto mb-3 h-8 w-8 text-slate-700" />
                  <p>Click a tag in the left rail to see every exchange that carries it,</p>
                  <p>or pick a session to read its full markdown log.</p>
                  <p className="mt-3 text-[11px] text-slate-600">
                    Click multiple tags to intersect — only exchanges with all selected
                    tags are returned.
                  </p>
                </div>
              </div>
            )}
            {view?.kind === "session" && (
              <>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="font-mono text-sm text-slate-200">{view.name}</div>
                  <button
                    onClick={() => setView(null)}
                    className="text-slate-500 hover:text-slate-200"
                    title="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="prose-invert max-w-none text-sm">
                  <MarkdownRenderer markdown={view.markdown} />
                </div>
              </>
            )}
            {view?.kind === "search" && (
              <>
                <div className="mb-3 flex items-center justify-between text-sm text-slate-300">
                  <span>
                    Exchanges tagged with{" "}
                    {view.tags.map((t, i) => (
                      <span key={t}>
                        <span className="font-mono text-blue-300">#{t}</span>
                        {i < view.tags.length - 1 && <span className="text-slate-500"> AND </span>}
                      </span>
                    ))}
                  </span>
                  <span className="text-xs text-slate-500">{view.hits.length} match{view.hits.length === 1 ? "" : "es"}</span>
                </div>
                {view.hits.length === 0 ? (
                  <p className="text-sm text-slate-500">No matches.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {view.hits.map((h, i) => (
                      <button
                        key={i}
                        onClick={() => openSession(h.session)}
                        className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-left transition hover:border-slate-700 hover:bg-slate-900/60"
                      >
                        <div className="text-sm text-slate-200">{h.header}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                          {h.session}
                          {h.matched > 1 && (
                            <span className="ml-2 text-blue-400">
                              · {h.matched} matching tags
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2">
      <span className="text-slate-500">{icon}</span>
      <span className="text-sm font-semibold text-slate-100 tabular-nums">{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}
