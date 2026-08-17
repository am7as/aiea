"use client";

import { useState } from "react";
import {
  ChevronDown,
  Plus,
  X,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from "lucide-react";

import {
  ApiError,
  testTaskRoute,
  updateTaskRoute,
  type Provider,
  type RouteModelIn,
  type RouteStatus,
  type TaskRoute,
} from "@/lib/api";

const GROUPS = ["Material", "Generation", "Evaluation", "Interaction", "Exam", "Meta"];

const STATUS_DOT: Record<RouteStatus, string> = {
  routed: "bg-emerald-500",
  unrouted: "bg-slate-500",
  broken: "bg-red-500",
};

const selectCls =
  "rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none disabled:opacity-50";
const numCls =
  "w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none";

type TestState = Record<string, { ok: boolean; detail: string } | "running">;

function isAgentProvider(p: Provider | undefined): boolean {
  return (
    p?.type === "subscription" &&
    (p.config as { mode?: string } | undefined)?.mode === "agent"
  );
}

export function RoutingPanel({
  initialRoutes,
  providers,
}: {
  initialRoutes: TaskRoute[];
  providers: Provider[];
}) {
  const [routes, setRoutes] = useState<TaskRoute[]>(initialRoutes);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tests, setTests] = useState<TestState>({});

  function replace(r: TaskRoute) {
    setRoutes((rs) => rs.map((x) => (x.task === r.task ? r : x)));
  }

  async function runTest(task: string) {
    setTests((t) => ({ ...t, [task]: "running" }));
    try {
      const r = await testTaskRoute(task);
      setTests((t) => ({ ...t, [task]: r }));
    } catch (e) {
      setTests((t) => ({
        ...t,
        [task]: { ok: false, detail: e instanceof ApiError ? e.message : "test failed" },
      }));
    }
  }

  const defaultRoute = routes.find((r) => r.task === "default");

  if (routes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center text-slate-400">
        Could not load task routes — is the api running?
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {providers.length === 0 && (
        <div className="rounded-xl border border-amber-700/50 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-200/90">
          No providers yet. Add and connect providers first — then assign them to tasks here.
        </div>
      )}

      {defaultRoute && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Default route
          </div>
          <RouteRow
            route={defaultRoute}
            providers={providers}
            expanded={expanded === "default"}
            onToggle={() => setExpanded(expanded === "default" ? null : "default")}
            test={tests["default"]}
            onTest={() => runTest("default")}
            onSaved={replace}
            isDefault
          />
        </div>
      )}

      {GROUPS.map((group) => {
        const rows = routes.filter((r) => r.group === group);
        if (rows.length === 0) return null;
        return (
          <div key={group}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {group}
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-800">
              {rows.map((r, i) => (
                <div key={r.task} className={i > 0 ? "border-t border-slate-800" : ""}>
                  <RouteRow
                    route={r}
                    providers={providers}
                    expanded={expanded === r.task}
                    onToggle={() => setExpanded(expanded === r.task ? null : r.task)}
                    test={tests[r.task]}
                    onTest={() => runTest(r.task)}
                    onSaved={replace}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> routed &amp; ok
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-slate-500" /> unrouted (uses Default)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500" /> provider down
        </span>
      </div>
    </div>
  );
}

function RouteRow({
  route,
  providers,
  expanded,
  onToggle,
  test,
  onTest,
  onSaved,
  isDefault,
}: {
  route: TaskRoute;
  providers: Provider[];
  expanded: boolean;
  onToggle: () => void;
  test: { ok: boolean; detail: string } | "running" | undefined;
  onTest: () => void;
  onSaved: (r: TaskRoute) => void;
  isDefault?: boolean;
}) {
  const primary = route.models.find((m) => m.role === "primary");
  const secondaries = route.models.filter((m) => m.role === "secondary");
  const isAgent = isAgentProvider(
    primary ? providers.find((p) => p.id === primary.provider_id) : undefined,
  );
  const summary = primary
    ? `${primary.provider_name} · ${primary.model}`
    : isDefault
      ? "no model assigned"
      : "unrouted → uses Default";

  const wrap = isDefault
    ? "rounded-2xl border border-slate-800 bg-slate-900/40"
    : "bg-slate-900/40";

  return (
    <div className={wrap}>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[route.status]}`} />
        <button onClick={onToggle} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-slate-100">{route.task}</span>
            {secondaries.length > 0 && (
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                +{secondaries.length} cross-check
              </span>
            )}
            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-500">
              {isAgent ? "agent" : route.context_mode}
            </span>
          </div>
          <div className="truncate text-[11px] text-slate-500">{route.description}</div>
          <div className="truncate text-xs text-slate-400">{summary}</div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {test && test !== "running" && (
            <span
              className={
                "flex items-center gap-1 text-[11px] " +
                (test.ok ? "text-emerald-400" : "text-red-400")
              }
            >
              {test.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              <span className="max-w-[260px] truncate">{test.detail}</span>
            </span>
          )}
          <button
            onClick={onTest}
            disabled={test === "running"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-50"
          >
            {test === "running" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Test route
          </button>
          <button onClick={onToggle} className="text-slate-500 hover:text-slate-200">
            <ChevronDown
              className={"h-4 w-4 transition-transform " + (expanded ? "rotate-180" : "")}
            />
          </button>
        </div>
      </div>
      {expanded && <RouteEditor route={route} providers={providers} onSaved={onSaved} />}
    </div>
  );
}

function ModelPicker({
  value,
  providers,
  onChange,
  onRemove,
}: {
  value: RouteModelIn | null;
  providers: Provider[];
  onChange: (v: RouteModelIn) => void;
  onRemove?: () => void;
}) {
  const prov = providers.find((p) => p.id === value?.provider_id);
  const models = prov?.models ?? [];
  return (
    <div className="flex items-center gap-2">
      <select
        className={selectCls}
        value={value?.provider_id ?? ""}
        onChange={(e) => {
          const p = providers.find((x) => x.id === e.target.value);
          onChange({
            provider_id: e.target.value,
            model: p?.models[0] ?? "",
            role: value?.role ?? "primary",
          });
        }}
      >
        <option value="">— provider —</option>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.connected ? "" : " (not connected)"}
          </option>
        ))}
      </select>
      <select
        className={selectCls}
        value={value?.model ?? ""}
        onChange={(e) => value && onChange({ ...value, model: e.target.value })}
        disabled={!value || models.length === 0}
      >
        {models.length === 0 && <option value="">— test provider for models —</option>}
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {onRemove && (
        <button
          onClick={onRemove}
          className="text-slate-500 hover:text-red-400"
          title="Remove"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function RouteEditor({
  route,
  providers,
  onSaved,
}: {
  route: TaskRoute;
  providers: Provider[];
  onSaved: (r: TaskRoute) => void;
}) {
  const p0 = route.models.find((m) => m.role === "primary");
  const [primary, setPrimary] = useState<RouteModelIn | null>(
    p0 ? { provider_id: p0.provider_id, model: p0.model, role: "primary" } : null,
  );
  const [secondaries, setSecondaries] = useState<RouteModelIn[]>(
    route.models
      .filter((m) => m.role === "secondary")
      .map((m) => ({ provider_id: m.provider_id, model: m.model, role: "secondary" as const })),
  );
  const [temperature, setTemperature] = useState(route.temperature);
  const [maxTokens, setMaxTokens] = useState(route.max_tokens);
  const [contextLength, setContextLength] = useState(route.context_length ?? 0);
  const [contextMode, setContextMode] = useState(route.context_mode);
  const [systemPrompt, setSystemPrompt] = useState(route.system_prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAgent = isAgentProvider(
    primary ? providers.find((p) => p.id === primary.provider_id) : undefined,
  );

  async function save() {
    setBusy(true);
    setError(null);
    const models: RouteModelIn[] = [
      ...(primary && primary.provider_id && primary.model
        ? [{ ...primary, role: "primary" as const }]
        : []),
      ...secondaries
        .filter((s) => s.provider_id && s.model)
        .map((s) => ({ ...s, role: "secondary" as const })),
    ];
    try {
      const updated = await updateTaskRoute(route.task, {
        temperature,
        max_tokens: maxTokens,
        context_length: contextLength || null,
        context_mode: contextMode,
        system_prompt: systemPrompt,
        models,
      });
      onSaved(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 border-t border-slate-800 bg-slate-950/40 px-4 py-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-slate-300">Primary model</label>
        <ModelPicker value={primary} providers={providers} onChange={setPrimary} />
        <span className="text-[11px] text-slate-500">Runs this task by default.</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-slate-300">Cross-check models</label>
        {secondaries.map((s, i) => (
          <ModelPicker
            key={i}
            value={s}
            providers={providers}
            onChange={(v) =>
              setSecondaries((arr) => arr.map((x, j) => (j === i ? { ...v, role: "secondary" } : x)))
            }
            onRemove={() => setSecondaries((arr) => arr.filter((_, j) => j !== i))}
          />
        ))}
        <button
          onClick={() =>
            setSecondaries((arr) => [...arr, { provider_id: "", model: "", role: "secondary" }])
          }
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600"
        >
          <Plus className="h-3.5 w-3.5" />
          Add model
        </button>
        <span className="text-[11px] text-slate-500">
          Optional — for cross-checking. Wired into the question screens in a later phase.
        </span>
      </div>

      {isAgent ? (
        <p className="text-[11px] text-slate-500">
          Temperature, max output tokens and context mode don&apos;t apply to agent-mode
          providers — the agent runs its own generation and manages its own working context.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-5">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-300">Temperature</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              className={numCls}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-300">Max output tokens</label>
            <input
              type="number"
              min="1"
              className={numCls}
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-300" title="The model's context window. AIEA sizes text chunks and page-image scale to fit it. 0 = unset.">
              Context length
            </label>
            <input
              type="number"
              min="0"
              step="1024"
              placeholder="auto"
              className={numCls}
              value={contextLength || ""}
              onChange={(e) => setContextLength(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-300">Context mode</label>
            <div className="flex gap-2">
              {(["isolated", "shared"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setContextMode(m)}
                  className={
                    "rounded-lg border px-2.5 py-1.5 text-xs transition-colors " +
                    (contextMode === m
                      ? "border-blue-500 bg-blue-500/10 text-blue-300"
                      : "border-slate-700 text-slate-300 hover:border-slate-600")
                  }
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-300">System prompt override</label>
        <textarea
          className="min-h-[60px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
          placeholder="Optional — appended to the skill-built system prompt for this task."
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save route
        </button>
      </div>
    </div>
  );
}
