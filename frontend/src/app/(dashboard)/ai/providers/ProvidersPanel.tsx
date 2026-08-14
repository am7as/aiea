"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Loader2,
  Plug,
  PlugZap,
  Pencil,
  Trash2,
  RefreshCw,
  Terminal,
  SendHorizonal,
  Eraser,
  Database,
} from "lucide-react";

import {
  ApiError,
  connectProvider,
  deleteProvider,
  disconnectProvider,
  providerChat,
  shimHealth,
  testProvider,
  type Provider,
  type ProviderStatus,
  type ProviderType,
  type ShimHealth,
} from "@/lib/api";
import { AddProviderModal } from "./AddProviderModal";

const TYPE_GROUPS: { type: ProviderType; label: string }[] = [
  { type: "subscription", label: "Subscription" },
  { type: "token", label: "Token" },
  { type: "lmstudio", label: "LM Studio" },
  { type: "ollama", label: "Ollama" },
];

const LIGHT: Record<ProviderStatus, string> = {
  unknown: "bg-slate-500",
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

function StatusLight({ status }: { status: ProviderStatus }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${LIGHT[status]} ${
        status === "healthy" ? "shadow-[0_0_6px] shadow-emerald-500/60" : ""
      }`}
    />
  );
}

function configSummary(p: Provider): string {
  const c = p.config;
  const dm = c.default_model ? ` · model ${c.default_model}` : "";
  if (p.type === "subscription") {
    if (c.mode === "agent") {
      return `${c.service ?? "claude"} agent · ${c.permission ?? "edit"} · dir ${c.working_dir || "~"}${dm}`;
    }
    return `${c.service ?? "?"} · chat · ${c.shim_url ?? "shim"}${dm}`;
  }
  if (p.type === "token") return `${c.base_url ?? "?"} · key ${c.api_key ?? "—"}${dm}`;
  return `${c.base_url ?? "—"}${dm}`;
}

type LogEntry = {
  kind: "system" | "user" | "model" | "error";
  text: string;
  meta?: string;
};

export function ProvidersPanel({ initial }: { initial: Provider[] }) {
  const [providers, setProviders] = useState<Provider[]>(initial);
  const [modal, setModal] = useState<{ provider?: Provider } | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const [shim, setShim] = useState<ShimHealth | null>(null);

  const [log, setLog] = useState<LogEntry[]>([]);
  const [consoleProvider, setConsoleProvider] = useState<string>("");
  const [consoleModel, setConsoleModel] = useState<string>("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const usable = useMemo(() => providers.filter((p) => p.models.length > 0), [providers]);
  const activeProvider = usable.find((p) => p.id === consoleProvider) ?? usable[0];
  const models = activeProvider?.models ?? [];
  const defaultModel = activeProvider?.config?.default_model;
  const activeModel = models.includes(consoleModel)
    ? consoleModel
    : typeof defaultModel === "string" && models.includes(defaultModel)
      ? defaultModel
      : models[0];

  useEffect(() => {
    let alive = true;
    const tick = () =>
      shimHealth()
        .then((s) => alive && setShim(s))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Persist the console chat — survives navigating away and back.
  const restored = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("aiea:console:v1");
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s?.log)) setLog(s.log);
        if (typeof s?.consoleProvider === "string") setConsoleProvider(s.consoleProvider);
        if (typeof s?.consoleModel === "string") setConsoleModel(s.consoleModel);
      }
    } catch {
      /* ignore */
    }
    restored.current = true;
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(
        "aiea:console:v1",
        JSON.stringify({ log, consoleProvider, consoleModel }),
      );
    } catch {
      /* ignore */
    }
  }, [log, consoleProvider, consoleModel]);

  function mark(id: string, on: boolean) {
    setBusy((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  function replace(p: Provider) {
    setProviders((list) => list.map((x) => (x.id === p.id ? p : x)));
  }

  async function runAction(id: string, fn: () => Promise<Provider>) {
    mark(id, true);
    try {
      replace(await fn());
    } catch (e) {
      pushLog({
        kind: "error",
        text: e instanceof ApiError ? e.message : "action failed",
      });
    } finally {
      mark(id, false);
    }
  }

  async function remove(p: Provider) {
    if (!confirm(`Delete provider "${p.name}"?`)) return;
    mark(p.id, true);
    try {
      await deleteProvider(p.id);
      setProviders((list) => list.filter((x) => x.id !== p.id));
    } catch (e) {
      pushLog({ kind: "error", text: e instanceof ApiError ? e.message : "delete failed" });
    } finally {
      mark(p.id, false);
    }
  }

  function pushLog(entry: LogEntry) {
    setLog((l) => [...l, entry]);
  }

  async function send() {
    const text = input.trim();
    if (!text || !activeProvider || !activeModel) return;

    if (text === "/test") {
      setInput("");
      pushLog({ kind: "system", text: `> /test ${activeProvider.name}` });
      mark(activeProvider.id, true);
      try {
        const updated = await testProvider(activeProvider.id);
        replace(updated);
        pushLog({
          kind: updated.status === "error" ? "error" : "system",
          text: `${updated.status} — ${updated.status_detail}`,
        });
      } catch (e) {
        pushLog({ kind: "error", text: e instanceof ApiError ? e.message : "test failed" });
      } finally {
        mark(activeProvider.id, false);
      }
      return;
    }

    setInput("");
    pushLog({ kind: "user", text, meta: `${activeProvider.name} · ${activeModel}` });
    setSending(true);
    try {
      const r = await providerChat(activeProvider.id, { model: activeModel, message: text });
      pushLog({
        kind: "model",
        text: r.reply || "(empty response)",
        meta: `${activeProvider.name} · ${r.model}`,
      });
    } catch (e) {
      pushLog({ kind: "error", text: e instanceof ApiError ? e.message : "request failed" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs">
          <span
            className={
              "h-2 w-2 shrink-0 rounded-full " +
              (shim?.running ? "bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500/60" : "bg-slate-500")
            }
          />
          <span className="text-slate-300">Host AI shim</span>
          {shim?.running ? (
            <span className="text-slate-500">running · {shim.models.length} model(s)</span>
          ) : (
            <span className="text-slate-500">
              not running — start with{" "}
              <code className="text-slate-400">pixi run up</code> or{" "}
              <code className="text-slate-400">pixi run shim start</code>
            </span>
          )}
        </div>
        <button
          onClick={() => setModal({})}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          <Plus className="h-4 w-4" />
          Add provider
        </button>
      </div>

      {providers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center">
          <p className="mb-1 text-slate-300">No providers yet.</p>
          <p className="text-sm text-slate-500">
            Add a subscription CLI, a token API, or a local LM Studio / Ollama server.
          </p>
        </div>
      ) : (
        TYPE_GROUPS.map((g) => {
          const rows = providers.filter((p) => p.type === g.type);
          if (rows.length === 0) return null;
          return (
            <div key={g.type}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {g.label} ({rows.length})
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-800">
                {rows.map((p, i) => (
                  <div
                    key={p.id}
                    className={
                      "flex items-center gap-4 bg-slate-900/40 px-4 py-3 " +
                      (i > 0 ? "border-t border-slate-800" : "")
                    }
                  >
                    <StatusLight status={p.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-100">
                          {p.name}
                        </span>
                        {p.connected && (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                            connected
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-slate-500">{configSummary(p)}</div>
                      <div className="truncate text-xs text-slate-400">
                        {p.status_detail || "not tested yet"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <RowButton
                        onClick={() => runAction(p.id, () => testProvider(p.id))}
                        busy={busy.has(p.id)}
                        icon={<RefreshCw className="h-3.5 w-3.5" />}
                        label="Test"
                      />
                      {p.connected ? (
                        <RowButton
                          onClick={() => runAction(p.id, () => disconnectProvider(p.id))}
                          busy={busy.has(p.id)}
                          icon={<PlugZap className="h-3.5 w-3.5" />}
                          label="Disconnect"
                        />
                      ) : (
                        <RowButton
                          onClick={() => runAction(p.id, () => connectProvider(p.id))}
                          busy={busy.has(p.id)}
                          icon={<Plug className="h-3.5 w-3.5" />}
                          label="Connect"
                          accent
                        />
                      )}
                      <RowButton
                        onClick={() => setModal({ provider: p })}
                        icon={<Pencil className="h-3.5 w-3.5" />}
                        label="Edit"
                      />
                      <RowButton
                        onClick={() => remove(p)}
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        label="Delete"
                        danger
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> healthy
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-500" /> warning
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500" /> test failed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-slate-500" /> never tested
        </span>
      </div>

      {/* Console */}
      <div className="overflow-hidden rounded-2xl border border-slate-800">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/60 px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <Terminal className="h-4 w-4" />
            Console
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">sends to</span>
            <select
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
              value={activeProvider?.id ?? ""}
              onChange={(e) => {
                setConsoleProvider(e.target.value);
                setConsoleModel("");
              }}
              disabled={usable.length === 0}
            >
              {usable.length === 0 && <option>no tested providers</option>}
              {usable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
              value={activeModel ?? ""}
              onChange={(e) => setConsoleModel(e.target.value)}
              disabled={models.length === 0}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              onClick={() => setLog([])}
              disabled={log.length === 0}
              title="Clear the console window"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-40"
            >
              <Eraser className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>
        </div>

        {activeProvider && (
          <div className="flex items-center gap-1.5 border-b border-slate-800 bg-slate-900/40 px-4 py-1.5 text-[11px] text-slate-500">
            <Database className="h-3 w-3" />
            <span>logged to memory:</span>
            <Link href="/ai/memory" className="font-mono text-slate-400 hover:text-slate-200">
              console-{activeProvider.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
            </Link>
          </div>
        )}

        <div className="h-56 space-y-1.5 overflow-y-auto bg-slate-950/60 px-4 py-3 font-mono text-xs">
          {log.length === 0 ? (
            <div className="text-slate-600">
              Pick a tested provider, then chat or type{" "}
              <span className="text-slate-400">/test</span> to re-run its healthcheck.
            </div>
          ) : (
            log.map((e, i) => {
              if (e.kind === "user") {
                return (
                  <div key={i} className="text-slate-300">
                    <span className="text-slate-500">&gt; </span>
                    {e.text}
                    {e.meta && <span className="text-slate-600"> → {e.meta}</span>}
                  </div>
                );
              }
              if (e.kind === "model") {
                return (
                  <div key={i}>
                    {e.meta && (
                      <div className="text-[10px] uppercase tracking-wide text-slate-600">
                        {e.meta}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap text-emerald-300">{e.text}</div>
                  </div>
                );
              }
              return (
                <div key={i} className={e.kind === "error" ? "text-red-400" : "text-slate-500"}>
                  {e.text}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-900/60 px-3 py-2.5">
          <input
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-50"
            placeholder={
              usable.length === 0
                ? "Test a provider to enable the console"
                : "Message the model, or /test to re-check it"
            }
            value={input}
            disabled={usable.length === 0 || sending}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            onClick={() => void send()}
            disabled={usable.length === 0 || sending || !input.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <SendHorizonal className="h-3.5 w-3.5" />
            )}
            Send
          </button>
        </div>
      </div>

      {modal && (
        <AddProviderModal
          provider={modal.provider}
          onClose={() => setModal(null)}
          onSaved={(p) => {
            setProviders((list) => {
              const exists = list.some((x) => x.id === p.id);
              return exists ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];
            });
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

function RowButton({
  onClick,
  icon,
  label,
  busy,
  accent,
  danger,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  busy?: boolean;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={label}
      className={
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 " +
        (accent
          ? "border-blue-600/60 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"
          : danger
            ? "border-slate-700 text-slate-400 hover:border-red-700/60 hover:text-red-400"
            : "border-slate-700 text-slate-300 hover:border-slate-600")
      }
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
