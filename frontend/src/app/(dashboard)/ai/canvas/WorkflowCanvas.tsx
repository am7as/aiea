"use client";

import { useCallback, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  User,
  Microscope,
  BookOpen,
  ListChecks,
  Brain,
  PenLine,
  Monitor,
  GitBranch,
  Bot,
  Boxes,
  Merge,
  Sparkles,
  Settings,
  HelpCircle,
  Play,
  ZoomIn,
  SlidersHorizontal,
  Download,
} from "lucide-react";

import { PanelA, PanelB, PanelC } from "./panels";

type IconKey =
  | "user"
  | "intent"
  | "knowledge"
  | "context"
  | "brain"
  | "pencil"
  | "monitor"
  | "branch"
  | "bot"
  | "task"
  | "merge"
  | "extract";

const ICONS: Record<IconKey, React.ComponentType<{ className?: string }>> = {
  user: User,
  intent: Microscope,
  knowledge: BookOpen,
  context: ListChecks,
  brain: Brain,
  pencil: PenLine,
  monitor: Monitor,
  branch: GitBranch,
  bot: Bot,
  task: Boxes,
  merge: Merge,
  extract: Sparkles,
};

type NodeColor = "teal" | "purple" | "green" | "orange" | "cyan";

const NODE_BORDER: Record<NodeColor, string> = {
  teal: "border-teal-500/70",
  purple: "border-purple-500/70",
  green: "border-emerald-500/70",
  orange: "border-orange-500/70",
  cyan: "border-cyan-500/70",
};
const NODE_TEXT: Record<NodeColor, string> = {
  teal: "text-teal-300",
  purple: "text-purple-300",
  green: "text-emerald-300",
  orange: "text-orange-300",
  cyan: "text-cyan-300",
};
const GLOW_HEX: Record<NodeColor, string> = {
  teal: "#2dd4bf",
  purple: "#c084fc",
  green: "#34d399",
  orange: "#fb923c",
  cyan: "#22d3ee",
};

type NodeData = {
  title: string;
  subtitle: string;
  color: NodeColor;
  icon: IconKey;
  glow?: boolean;
  panel?: "A" | "B" | "C";
};

function FlowNode({ data }: NodeProps) {
  const d = data as unknown as NodeData;
  const Icon = ICONS[d.icon];
  return (
    <div
      className={`w-48 rounded-lg border bg-slate-900 px-2.5 py-2 ${NODE_BORDER[d.color]}`}
      style={d.glow ? { boxShadow: `0 0 22px ${GLOW_HEX[d.color]}66` } : undefined}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-slate-500" />
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${NODE_TEXT[d.color]}`} />
        <span className="text-[11px] font-semibold text-slate-100">{d.title}</span>
      </div>
      <div className="mt-0.5 text-[10px] leading-tight text-slate-500">{d.subtitle}</div>
      {d.panel && (
        <div className={`mt-1 text-[9px] ${NODE_TEXT[d.color]}`}>● linked panel — click</div>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-slate-500" />
    </div>
  );
}

const nodeTypes = { flow: FlowNode };

function mk(
  id: string,
  x: number,
  y: number,
  data: NodeData,
): Node {
  return { id, type: "flow", position: { x, y }, data: data as unknown as Record<string, unknown> };
}

const INITIAL_NODES: Node[] = [
  mk("user-input", 0, 250, { title: "USER INPUT", subtitle: "Analyse request", color: "teal", icon: "user" }),
  mk("intent", 240, 250, { title: "INTENT RECOGNITION", subtitle: "Analyse goal & context", color: "teal", icon: "intent" }),
  mk("knowledge", 480, 110, { title: "KNOWLEDGE RETRIEVAL", subtitle: "Search vector DB & docs", color: "purple", icon: "knowledge", panel: "A" }),
  mk("context", 480, 390, { title: "CONTEXT ANALYSIS", subtitle: "Review conversation history", color: "green", icon: "context" }),
  mk("reasoning", 740, 250, { title: "AI REASONING CORE", subtitle: "Synthesise & reconcile", color: "teal", icon: "brain", glow: true }),
  mk("response", 1000, 250, { title: "RESPONSE GENERATION", subtitle: "Formulate final answer", color: "teal", icon: "pencil" }),
  mk("output", 1260, 250, { title: "USER OUTPUT", subtitle: "Display in chat", color: "teal", icon: "monitor" }),
  mk("edit-branch-b", 1520, 90, { title: "User Edit Branch B", subtitle: "Branch B edit set", color: "teal", icon: "branch" }),
  mk("user-edits-b1", 1520, 410, { title: "User Edits B-1", subtitle: "Edit in progress", color: "orange", icon: "pencil", glow: true, panel: "B" }),
  mk("ai-response-b2", 1780, 250, { title: "AI Response B-2", subtitle: "Regenerated reply", color: "teal", icon: "bot", panel: "C" }),
  mk("task-node-1", 1780, 70, { title: "Task-Specific Node 1", subtitle: "Branch B sub-task", color: "teal", icon: "task" }),
  mk("merge-a", 2040, 160, { title: "Merge Point A", subtitle: "Reconcile branches", color: "teal", icon: "merge" }),
];

const TEAL = "#2dd4bf";
const ORANGE = "#fb923c";

function edge(id: string, s: string, t: string, color = TEAL): Edge {
  return { id, source: s, target: t, animated: true, style: { stroke: color, strokeWidth: 1.5 } };
}

const INITIAL_EDGES: Edge[] = [
  edge("e1", "user-input", "intent"),
  edge("e2", "intent", "knowledge"),
  edge("e3", "intent", "context"),
  edge("e4", "knowledge", "reasoning"),
  edge("e5", "context", "reasoning"),
  edge("e6", "reasoning", "response"),
  edge("e7", "response", "output"),
  edge("e8", "output", "edit-branch-b"),
  edge("e9", "output", "user-edits-b1", ORANGE),
  edge("e10", "user-edits-b1", "ai-response-b2", ORANGE),
  edge("e11", "user-edits-b1", "reasoning", ORANGE),
  edge("e12", "edit-branch-b", "task-node-1"),
  edge("e13", "edit-branch-b", "ai-response-b2"),
  edge("e14", "task-node-1", "merge-a"),
  edge("e15", "ai-response-b2", "merge-a"),
];

const TOOLBAR = [
  { icon: Play, label: "Run now" },
  { icon: ZoomIn, label: "Zoom" },
  { icon: SlidersHorizontal, label: "Config" },
  { icon: Download, label: "Export" },
  { icon: HelpCircle, label: "Help" },
];

export function WorkflowCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(INITIAL_EDGES);
  const [open, setOpen] = useState<Set<"A" | "B" | "C">>(new Set());
  const [selected, setSelected] = useState<NodeData | null>(null);
  const counterRef = useRef(0);

  const togglePanel = useCallback((p: "A" | "B" | "C") => {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  }, []);

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      const d = node.data as unknown as NodeData;
      setSelected(d);
      if (d.panel) togglePanel(d.panel);
    },
    [togglePanel],
  );

  const addNode = useCallback(
    (kind: "extraction" | "branch", from: string) => {
      counterRef.current += 1;
      const i = counterRef.current;
      const id = `${kind}-${i}`;
      const isExtraction = kind === "extraction";
      setNodes((nds) => [
        ...nds,
        mk(id, isExtraction ? 2040 : 1780, 470 + (i - 1) * 110, {
          title: isExtraction ? `Extraction Node ${i}` : `Branch ${i}`,
          subtitle: isExtraction ? "From AI synthesis" : "New edit branch",
          color: isExtraction ? "cyan" : "orange",
          icon: isExtraction ? "extract" : "branch",
        }),
      ]);
      setEdges((eds) => [
        ...eds,
        edge(`x-${id}`, from, id, isExtraction ? GLOW_HEX.cyan : ORANGE),
      ]);
    },
    [setNodes, setEdges],
  );

  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl border border-slate-800"
      style={{ height: "calc(100vh - 7.5rem)" }}
    >
      {/* Header — conversation log */}
      <div className="flex items-start gap-4 border-b border-slate-800 bg-slate-950 px-4 py-2.5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[9px] text-slate-200">
              U
            </span>
            <span className="text-xs text-slate-300">
              <span className="text-slate-500">User:</span> Can you explain how this AI chat system
              works using a diagram?
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-[9px] text-white">
              AI
            </span>
            <span className="text-xs text-slate-300">
              <span className="text-slate-500">AI:</span> Absolutely! Below is an interactive flow
              diagram showing how I process your requests.
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <button className="text-slate-500 hover:text-slate-200" title="Settings">
            <Settings className="h-4 w-4" />
          </button>
          <button className="text-slate-500 hover:text-slate-200" title="Help">
            <HelpCircle className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-2">
        <span className="text-sm font-semibold text-slate-100">Workflow Block Diagram</span>
        <div className="flex items-center gap-1.5">
          {TOOLBAR.map((t) => (
            <button
              key={t.label}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-600"
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
          minZoom={0.2}
        >
          <Background gap={20} />
          <Controls />
        </ReactFlow>

        {open.has("A") && (
          <PanelA onClose={() => togglePanel("A")} style={{ top: 12, left: 360 }} />
        )}
        {open.has("B") && (
          <PanelB
            onClose={() => togglePanel("B")}
            onCreateBranch={() => addNode("branch", "user-edits-b1")}
            style={{ bottom: 12, left: 16 }}
          />
        )}
        {open.has("C") && (
          <PanelC
            onClose={() => togglePanel("C")}
            onCreateExtractionNode={() => addNode("extraction", "ai-response-b2")}
            style={{ top: 12, right: 12 }}
          />
        )}
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-between gap-4 border-t border-slate-800 bg-slate-950 px-4 py-2 text-[11px]">
        <span className="truncate text-slate-400">
          <span className="text-slate-600">SELECTED CONTEXT:</span>{" "}
          {selected ? selected.title : "—"} · Session sess_14 · Version 3
        </span>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-slate-500">
            Last Sync: 1 min ago <span className="text-emerald-400">✓ Synced</span>
          </span>
          <span className="rounded border border-slate-700 px-2 py-0.5 text-slate-400">
            Zoom · fit
          </span>
        </div>
      </div>
    </div>
  );
}
