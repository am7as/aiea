"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";

import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { cn } from "@/lib/cn";
import type { DocsNode, DocsTree } from "@/lib/api";

export function DocsShell({
  tree,
  activePath,
  markdown,
}: {
  tree: DocsTree | null;
  activePath: string;
  markdown: string;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 max-h-[calc(100vh-6rem)] overflow-auto">
          <div className="flex items-center gap-2 mb-3 px-1">
            <BookOpen className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-100">Docs</h2>
          </div>
          {tree ? (
            <DocsTreeView nodes={tree.tree} activePath={activePath} />
          ) : (
            <p className="text-xs text-slate-500 italic px-1">
              Could not load docs tree.
            </p>
          )}
        </div>
      </aside>

      <main className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 lg:p-8 min-w-0">
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-4 font-mono">
          <span>docs/</span>
          {activePath.split("/").map((seg, i, all) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              <span className={i === all.length - 1 ? "text-slate-300" : ""}>{seg}</span>
            </span>
          ))}
        </div>
        <MarkdownRenderer markdown={markdown} />
      </main>
    </div>
  );
}

function DocsTreeView({ nodes, activePath }: { nodes: DocsNode[]; activePath: string }) {
  return (
    <ul className="space-y-0.5 text-sm">
      {nodes.map((node) => (
        <DocsTreeNode key={node.path} node={node} activePath={activePath} depth={0} />
      ))}
    </ul>
  );
}

function DocsTreeNode({
  node,
  activePath,
  depth,
}: {
  node: DocsNode;
  activePath: string;
  depth: number;
}) {
  const isActive = node.type === "file" && node.path === activePath;
  const childActive = useMemo(() => {
    if (node.type === "folder") {
      return activePath.startsWith(node.path + "/");
    }
    return false;
  }, [node, activePath]);
  const [open, setOpen] = useState(childActive || depth === 0);

  if (node.type === "folder") {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-left",
            "hover:bg-slate-800/60 text-slate-300",
            childActive && "text-slate-100",
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 text-slate-500 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-slate-500 shrink-0" />
          )}
          <Folder className="h-3.5 w-3.5 text-slate-500 shrink-0" />
          <span className="text-xs">{node.name}</span>
        </button>
        {open && (
          <ul className="space-y-0.5">
            {node.children.map((c) => (
              <DocsTreeNode key={c.path} node={c} activePath={activePath} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  // file
  const href = `/docs/${node.path.replace(/\.md$/, "")}`;
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-lg",
          isActive
            ? "bg-blue-500/15 text-blue-300 border-l-2 border-blue-500"
            : "hover:bg-slate-800/60 text-slate-400 hover:text-slate-200",
        )}
        style={{ paddingLeft: `${depth * 12 + 8 + (isActive ? -2 : 0)}px` }}
      >
        <span className="w-3 inline-block shrink-0" />
        <FileText className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-blue-400" : "text-slate-500")} />
        <span className="text-xs truncate">{node.name}</span>
      </Link>
    </li>
  );
}
