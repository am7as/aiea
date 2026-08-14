"use client";

import { useState } from "react";
import { X, Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

import {
  ApiError,
  createProvider,
  testProviderConfig,
  updateProvider,
  type Provider,
  type ProviderStatus,
  type ProviderType,
} from "@/lib/api";

type Config = Record<string, unknown>;

const TYPE_OPTIONS: { value: ProviderType; label: string; hint: string }[] = [
  { value: "subscription", label: "Subscription", hint: "A CLI you already pay for (Claude / Gemini)" },
  { value: "token", label: "Token", hint: "Pay-per-token API with a key" },
  { value: "lmstudio", label: "LM Studio", hint: "Local models served by LM Studio — free" },
  { value: "ollama", label: "Ollama", hint: "Local models served by Ollama — free" },
];

const SUBSCRIPTION_MODELS: Record<string, string[]> = {
  claude: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
};

type Preset = { id: string; label: string; baseUrl: string; models: string[] };

const TOKEN_PRESETS: Preset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3", "o4-mini"],
  },
  {
    id: "gemini",
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    models: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["openai/gpt-4o", "anthropic/claude-sonnet-4.6", "google/gemini-2.5-pro"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-small-latest"],
  },
  {
    id: "xai",
    label: "xAI Grok",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-3", "grok-2-latest"],
  },
];

const SUBSCRIPTION_SERVICES: { id: string; label: string }[] = [
  { id: "claude", label: "Claude (Pro / Max)" },
  { id: "gemini", label: "Gemini" },
];

// The shim is service-scoped: /claude/v1 or /gemini/v1 only expose that one CLI.
function scopedShimUrl(currentUrl: string, service: string): string {
  const base = (currentUrl || "http://host.docker.internal:4023")
    .replace(/\/(?:claude|gemini)\/v1\/?$/, "")
    .replace(/\/v1\/?$/, "")
    .replace(/\/$/, "");
  return `${base}/${service}/v1`;
}

function slugName(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function defaultWorkdir(service: string, name: string): string {
  return `~/.ai/${service || "claude"}/${slugName(name) || "agent"}`;
}

function defaultConfig(type: ProviderType): Config {
  switch (type) {
    case "subscription":
      return {
        service: "claude",
        mode: "chat",
        shim_url: "http://host.docker.internal:4023/claude/v1",
        working_dir: "",
        permission: "edit",
        default_model: "",
      };
    case "token":
      return { api_key: "", base_url: "https://api.openai.com/v1", default_model: "" };
    case "lmstudio":
      return { base_url: "http://host.docker.internal:1234/v1", default_model: "" };
    case "ollama":
      return { base_url: "http://host.docker.internal:11434/v1", default_model: "" };
  }
}

function field(
  label: string,
  hint: string,
  input: React.ReactNode,
) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-300">{label}</label>
      {input}
      <span className="text-[11px] text-slate-500">{hint}</span>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500";

export function AddProviderModal({
  provider,
  onClose,
  onSaved,
}: {
  provider?: Provider;
  onClose: () => void;
  onSaved: (p: Provider) => void;
}) {
  const editing = !!provider;
  const [name, setName] = useState(provider?.name ?? "");
  const [type, setType] = useState<ProviderType>(provider?.type ?? "subscription");
  const [config, setConfig] = useState<Config>(() => {
    if (!provider) return defaultConfig("subscription");
    const c = { ...provider.config };
    if (provider.type === "subscription") {
      c.shim_url = scopedShimUrl(
        (c.shim_url as string) || "",
        (c.service as string) || "claude",
      );
    }
    return c;
  });
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{
    status: ProviderStatus;
    detail: string;
    models: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presetModels, setPresetModels] = useState<string[]>(() => {
    if (provider?.type === "token") {
      const m = TOKEN_PRESETS.find((p) => p.baseUrl === provider.config.base_url);
      return m ? m.models : [];
    }
    return [];
  });

  const [workdirTouched, setWorkdirTouched] = useState(editing);

  function pickType(t: ProviderType) {
    setType(t);
    setConfig(defaultConfig(t));
    setTest(null);
    setPresetModels([]);
  }

  function pickMode(m: string) {
    setConfig((c) => {
      const next: Config = { ...c, mode: m };
      if (m === "agent" && !workdirTouched) {
        next.working_dir = defaultWorkdir((c.service as string) || "claude", name);
      }
      return next;
    });
    setTest(null);
  }

  function pickService(id: string) {
    setConfig((c) => {
      const next: Config = {
        ...c,
        service: id,
        shim_url: scopedShimUrl((c.shim_url as string) || "", id),
      };
      if (c.mode === "agent" && !workdirTouched) {
        next.working_dir = defaultWorkdir(id, name);
      }
      return next;
    });
    setTest(null);
  }

  function applyPreset(p: Preset) {
    setConfig((c) => ({ ...c, base_url: p.baseUrl }));
    setPresetModels(p.models);
    setTest(null);
  }

  function set(key: string, value: unknown) {
    setConfig((c) => ({ ...c, [key]: value }));
    if (key !== "default_model") setTest(null);
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    setError(null);
    try {
      const r = await testProviderConfig({ type, config });
      setTest({ status: r.status, detail: r.detail, models: r.models });
    } catch (e) {
      setTest({
        status: "error",
        detail: e instanceof ApiError ? e.message : "test failed",
        models: [],
      });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = editing
        ? await updateProvider(provider!.id, { name: name.trim(), config })
        : await createProvider({ name: name.trim(), type, config });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  const str = (k: string) => (config[k] as string | undefined) ?? "";

  const knownModels =
    type === "subscription"
      ? SUBSCRIPTION_MODELS[str("service")] ?? []
      : Array.from(
          new Set([...presetModels, ...(provider?.models ?? []), ...(test?.models ?? [])]),
        );

  const activePreset =
    type === "token" ? TOKEN_PRESETS.find((p) => p.baseUrl === str("base_url")) : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-100">
            {editing ? "Edit provider" : "Add provider"}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          {field(
            "Name",
            "A label for this connection.",
            <input
              className={inputCls}
              value={name}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                if (type === "subscription" && config.mode === "agent" && !workdirTouched) {
                  setConfig((c) => ({
                    ...c,
                    working_dir: defaultWorkdir((c.service as string) || "claude", v),
                  }));
                }
              }}
              placeholder="My Claude"
            />,
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-300">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map((o) => {
                const active = type === o.value;
                return (
                  <button
                    key={o.value}
                    disabled={editing}
                    onClick={() => pickType(o.value)}
                    className={
                      "rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 " +
                      (active
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-slate-700 bg-slate-950 hover:border-slate-600")
                    }
                  >
                    <div className="text-sm font-medium text-slate-100">{o.label}</div>
                    <div className="text-[11px] text-slate-500">{o.hint}</div>
                  </button>
                );
              })}
            </div>
            {editing && (
              <span className="text-[11px] text-slate-500">Type can&apos;t be changed after creation.</span>
            )}
          </div>

          {type === "subscription" && (
            <>
              <div className="rounded-lg border border-amber-700/50 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
                Subscription providers reach your logged-in host CLI through the AIEA shim. Start it
                on your machine first:
                <code className="mt-1 block rounded bg-slate-950 px-2 py-1 text-slate-300">
                  node scripts/host-ai-shim.mjs
                </code>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-300">Service</label>
                <div className="flex flex-wrap gap-1.5">
                  {SUBSCRIPTION_SERVICES.map((s) => {
                    const active = str("service") === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => pickService(s.id)}
                        className={
                          "rounded-full border px-2.5 py-1 text-xs transition-colors " +
                          (active
                            ? "border-blue-500 bg-blue-500/10 text-blue-300"
                            : "border-slate-700 text-slate-300 hover:border-slate-600")
                        }
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[11px] text-slate-500">
                  Which logged-in CLI on the host to use. The shim must have that CLI installed.
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-300">Mode</label>
                <div className="flex gap-1.5">
                  {(["chat", "agent"] as const).map((m) => {
                    const active = (str("mode") || "chat") === m;
                    return (
                      <button
                        key={m}
                        onClick={() => pickMode(m)}
                        className={
                          "rounded-full border px-3 py-1 text-xs transition-colors " +
                          (active
                            ? "border-blue-500 bg-blue-500/10 text-blue-300"
                            : "border-slate-700 text-slate-300 hover:border-slate-600")
                        }
                      >
                        {m === "chat" ? "Chat" : "Agent"}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[11px] text-slate-500">
                  {str("mode") === "agent"
                    ? `Agent — the full ${str("service") === "gemini" ? "Gemini CLI" : "Claude Code"} agent: tools, MCP, skills. It can read, write and run commands inside the working directory below.`
                    : "Chat — the CLI as a plain text engine. Fast, no tools."}
                </span>
              </div>
              {field(
                "Shim URL",
                "Where the host shim listens. The /claude or /gemini segment scopes it to that one CLI — set automatically when you pick a service above.",
                <input
                  className={inputCls}
                  value={str("shim_url")}
                  onChange={(e) => set("shim_url", e.target.value)}
                  placeholder="http://host.docker.internal:4023/v1"
                />,
              )}
              {str("mode") === "agent" &&
                field(
                  "Working directory",
                  "The agent's home — defaults to ~/.ai/<provider>, auto-created with its own instructions file + config dir (CLAUDE.md/.claude or GEMINI.md/.gemini). Change it to point the agent elsewhere.",
                  <input
                    className={inputCls}
                    value={str("working_dir")}
                    onChange={(e) => {
                      set("working_dir", e.target.value);
                      setWorkdirTouched(true);
                    }}
                    placeholder="~/.ai/my-agent"
                  />,
                )}
              {str("mode") === "agent" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-300">Permission</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { id: "read", label: "Read-only" },
                      { id: "edit", label: "Edit files" },
                      { id: "full", label: "Full access" },
                    ].map((o) => {
                      const active = (str("permission") || "edit") === o.id;
                      return (
                        <button
                          key={o.id}
                          onClick={() => set("permission", o.id)}
                          className={
                            "rounded-full border px-2.5 py-1 text-xs transition-colors " +
                            (active
                              ? "border-blue-500 bg-blue-500/10 text-blue-300"
                              : "border-slate-700 text-slate-300 hover:border-slate-600")
                          }
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {str("permission") === "read"
                      ? "Read & search only — no writing, no shell commands."
                      : str("permission") === "full"
                        ? "Everything, including running shell commands."
                        : "Read & write files in the working directory — no shell."}
                  </span>
                </div>
              )}
            </>
          )}

          {type === "token" && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300">Quick fill</label>
                <div className="flex flex-wrap gap-1.5">
                  {TOKEN_PRESETS.map((p) => {
                    const active = activePreset?.id === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => applyPreset(p)}
                        className={
                          "rounded-full border px-2.5 py-1 text-xs transition-colors " +
                          (active
                            ? "border-blue-500 bg-blue-500/10 text-blue-300"
                            : "border-slate-700 text-slate-300 hover:border-slate-600")
                        }
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[11px] text-slate-500">
                  Picks a known service — fills the base URL and suggests model names. Everything
                  stays editable.
                </span>
              </div>
              {field(
                "API base URL",
                "Full base — AIEA appends /chat/completions and /models. e.g. OpenAI https://api.openai.com/v1 · Gemini https://generativelanguage.googleapis.com/v1beta/openai",
                <input
                  className={inputCls}
                  value={str("base_url")}
                  onChange={(e) => set("base_url", e.target.value)}
                  placeholder="https://api.openai.com/v1"
                />,
              )}
              {field(
                "API key",
                "Stored locally; shown masked after saving.",
                <input
                  className={inputCls}
                  type="password"
                  value={str("api_key")}
                  onChange={(e) => set("api_key", e.target.value)}
                  placeholder="sk-…"
                />,
              )}
            </>
          )}

          {(type === "lmstudio" || type === "ollama") && (
            <>
              {field(
                "Server URL",
                type === "lmstudio"
                  ? "LM Studio's local server (default port 1234)."
                  : "Ollama's local server (default port 11434).",
                <input
                  className={inputCls}
                  value={str("base_url")}
                  onChange={(e) => set("base_url", e.target.value)}
                />,
              )}
            </>
          )}

          {field(
            "Default model",
            "Used by default in the console and task routing. Test first to populate the list, or type a model name.",
            <>
              <input
                className={inputCls}
                list="aiea-model-options"
                value={str("default_model")}
                onChange={(e) => set("default_model", e.target.value)}
                placeholder={knownModels[0] ?? "model name"}
              />
              <datalist id="aiea-model-options">
                {knownModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>,
          )}

          {test && (
            <div
              className={
                "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs " +
                (test.status === "healthy"
                  ? "border-emerald-700/60 bg-emerald-500/10 text-emerald-300"
                  : test.status === "warning"
                    ? "border-amber-700/60 bg-amber-500/10 text-amber-300"
                    : "border-red-700/60 bg-red-500/10 text-red-300")
              }
            >
              {test.status === "healthy" ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : test.status === "warning" ? (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <span>{test.detail || test.status}</span>
            </div>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        <div className="flex items-center justify-between border-t border-slate-800 px-5 py-4">
          <button
            onClick={runTest}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-slate-600 disabled:opacity-50"
          >
            {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Test connection
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editing ? "Save" : "Add provider"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
