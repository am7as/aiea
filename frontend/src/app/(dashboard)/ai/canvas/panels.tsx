"use client";

import { useState } from "react";
import {
  X,
  Search,
  Filter,
  Bold,
  Italic,
  List,
  Table,
  Code,
  Highlighter,
  Square,
  Copy,
  SquarePen,
  Plus,
} from "lucide-react";

type Accent = {
  border: string;
  head: string;
  text: string;
};

const ACCENTS: Record<string, Accent> = {
  purple: { border: "border-purple-500/60", head: "bg-purple-500/10", text: "text-purple-300" },
  orange: { border: "border-orange-500/60", head: "bg-orange-500/10", text: "text-orange-300" },
  cyan: { border: "border-cyan-500/60", head: "bg-cyan-500/10", text: "text-cyan-300" },
};

function PanelShell({
  title,
  subtitle,
  accent,
  onClose,
  style,
  children,
}: {
  title: string;
  subtitle?: string;
  accent: keyof typeof ACCENTS;
  onClose: () => void;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  const a = ACCENTS[accent];
  return (
    <div
      className={`absolute z-30 w-[380px] overflow-hidden rounded-xl border ${a.border} bg-slate-900/95 shadow-2xl backdrop-blur`}
      style={style}
    >
      <div
        className={`flex items-center justify-between border-b border-slate-800 px-3 py-2 ${a.head}`}
      >
        <div className="min-w-0">
          <div className={`text-xs font-semibold ${a.text}`}>{title}</div>
          {subtitle && <div className="truncate text-[10px] text-slate-500">{subtitle}</div>}
        </div>
        <button onClick={onClose} className="shrink-0 text-slate-500 hover:text-slate-200">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-[420px] overflow-y-auto p-3">{children}</div>
    </div>
  );
}

// 3.1 — Expanded Data Source Context (purple)
const VECTOR_ROWS = [
  { id: 1, vector: "[.39, 0.05, .090, .77, …]", kb: "Knowledge Base 1" },
  { id: 2, vector: "[.12, 0.88, .431, .04, …]", kb: "Knowledge Base 2" },
  { id: 3, vector: "[.56, 0.21, .700, .19, …]", kb: "Knowledge Base 1" },
  { id: 4, vector: "[.07, 0.63, .284, .92, …]", kb: "Knowledge Base 3" },
];

export function PanelA({ onClose, style }: { onClose: () => void; style: React.CSSProperties }) {
  const [q, setQ] = useState("");
  return (
    <PanelShell title="Expanded Data Source Context" accent="purple" onClose={onClose} style={style}>
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5">
        <Search className="h-3.5 w-3.5 text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search vectors…"
          className="flex-1 bg-transparent text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none"
        />
        <Filter className="h-3.5 w-3.5 text-slate-500" />
      </div>
      <table className="w-full text-left text-[11px]">
        <thead>
          <tr className="text-slate-500">
            <th className="pb-1 pr-2 font-medium">Raw ID</th>
            <th className="pb-1 pr-2 font-medium">Raw Vector</th>
            <th className="pb-1 font-medium">Knowledge Base</th>
          </tr>
        </thead>
        <tbody className="font-mono text-slate-300">
          {VECTOR_ROWS.filter(
            (r) => !q || r.vector.includes(q) || r.kb.toLowerCase().includes(q.toLowerCase()),
          ).map((r) => (
            <tr key={r.id} className="border-t border-slate-800">
              <td className="py-1.5 pr-2 text-slate-400">{r.id}</td>
              <td className="py-1.5 pr-2">{r.vector}</td>
              <td className="py-1.5 text-purple-300">{r.kb}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 border-t border-slate-800 pt-2 text-[10px] text-slate-500">
        4 vectors · Last Update: 2026-10-02
      </div>
    </PanelShell>
  );
}

// 3.2 — User Node Context (orange) — markdown + JSON editor
const NODE_JSON = `{
  "node_id": "User_Edits_B1",
  "content": {
    "type": "user_input",
    "markdown": "**Bold text.** Can you explain...",
    "metadata": {
      "parent": "AI_Response_A",
      "action": "edit",
      "history": { "v1": "...original...", "v2": "...previous..." }
    }
  },
  "status": "pending_update"
}`;

const TOOL_ICONS = [Bold, Italic, List, Table, Code];

export function PanelB({
  onClose,
  style,
  onCreateBranch,
}: {
  onClose: () => void;
  style: React.CSSProperties;
  onCreateBranch: () => void;
}) {
  const [text, setText] = useState(
    "**Bold text.** Can you explain how this AI system works with markdown formatting…\n\nThis is the core task node.",
  );
  return (
    <PanelShell
      title="USER NODE CONTEXT (Orange)"
      subtitle="node: User_Edits_B1"
      accent="orange"
      onClose={onClose}
      style={style}
    >
      <div className="mb-2 flex items-center gap-1">
        {TOOL_ICONS.map((Icon, i) => (
          <button
            key={i}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <span className="ml-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] text-amber-300">
          comment added
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="mb-2 h-20 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:border-orange-500/60 focus:outline-none"
      />
      <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">node data</div>
      <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-2 text-[10px] leading-relaxed text-slate-300">
        <code>{NODE_JSON}</code>
      </pre>
      <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-2">
        <span className="text-[10px] text-slate-500">Version: 3 · synced</span>
        <div className="flex gap-1.5">
          <button className="rounded-lg bg-blue-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-600">
            Update Current Branch
          </button>
          <button
            onClick={onCreateBranch}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-500/80 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-600"
          >
            <Plus className="h-3 w-3" />
            Create New Branch
          </button>
        </div>
      </div>
    </PanelShell>
  );
}

// 3.3 — AI Node Context (cyan) — synthesis + annotations
const ANNOTATIONS = [
  { author: "Annotation 1", text: "Key insight identified", time: "12:31 PM" },
  { author: "Annotation 2", text: "Core concept confirmed", time: "12:36 PM" },
  { author: "Annotation 3", text: "Redundancy flagged for review", time: "12:40 PM" },
];

const CONTEXT_ACTIONS = [
  { icon: Highlighter, label: "Highlighter" },
  { icon: Square, label: "Box Draw" },
  { icon: Copy, label: "Copy Selected" },
  { icon: SquarePen, label: "Edit Annotations" },
];

export function PanelC({
  onClose,
  style,
  onCreateExtractionNode,
}: {
  onClose: () => void;
  style: React.CSSProperties;
  onCreateExtractionNode: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <PanelShell
      title="AI NODE CONTEXT (Cyan)"
      subtitle="AI Node: [session_id]_14.md"
      accent="cyan"
      onClose={onClose}
      style={style}
    >
      <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">interactive view</div>
      <p className="mb-2 text-xs leading-relaxed text-slate-300">
        Clearly summarize the core insights from the source material, avoiding{" "}
        <span className="rounded bg-yellow-400/25 px-0.5 text-yellow-100 ring-1 ring-red-500/70">
          redundancies. This synthesized knowledge
        </span>{" "}
        will directly inform the next reasoning step.
      </p>

      <div className="mb-3 flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1.5">
        {CONTEXT_ACTIONS.map((a) => (
          <button
            key={a.label}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <a.icon className="h-3 w-3" />
            {a.label}
          </button>
        ))}
        <button
          onClick={onCreateExtractionNode}
          className="inline-flex items-center gap-1 rounded bg-blue-500 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-600"
        >
          <Plus className="h-3 w-3" />
          Create New Extraction Node
        </button>
      </div>

      <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">discussion</div>
      <div className="mb-2 space-y-1.5">
        {ANNOTATIONS.map((an) => (
          <div key={an.author} className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-200">{an.author}</span>
              <span className="text-[9px] text-slate-600">{an.time}</span>
            </div>
            <div className="text-[11px] text-slate-400">{an.text}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add an annotation…"
          className="flex-1 bg-transparent text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none"
        />
      </div>
    </PanelShell>
  );
}
