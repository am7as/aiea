"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  SendHorizonal,
  ArrowLeftRight,
  Compass,
  FlaskConical,
  Eraser,
  RotateCcw,
  Database,
} from "lucide-react";

import { ApiError, providerChat, type Provider } from "@/lib/api";

type Which = "orchestrator" | "worker";
type Mode = "persisted" | "isolated";

type Turn = { role: "user" | "assistant"; content: string; tag?: string; error?: boolean };

type Pane = {
  providerId: string;
  model: string;
  turns: Turn[];
  visibleFrom: number; // display shows turns.slice(visibleFrom)
  mode: Mode;
  sessionId: string;
  input: string;
  sending: boolean;
};

const STORE_KEY = "aiea:chatpanel:v2";

function newSessionId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function makePane(usable: Provider[], pref?: { providerId: string; model: string }): Pane {
  const p = usable.find((x) => x.id === pref?.providerId) ?? usable[0];
  const model = pref?.model && p?.models.includes(pref.model) ? pref.model : (p?.models[0] ?? "");
  return {
    providerId: p?.id ?? "",
    model,
    turns: [],
    visibleFrom: 0,
    mode: "persisted",
    sessionId: "", // assigned after mount — avoids SSR/client random mismatch
    input: "",
    sending: false,
  };
}

const selectCls =
  "rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none disabled:opacity-50";

export function ChatPanel({
  providers,
  orchestrator,
}: {
  providers: Provider[];
  orchestrator: { providerId: string; model: string } | null;
}) {
  const usable = providers.filter((p) => p.connected && p.models.length > 0);
  const [panes, setPanes] = useState<Record<Which, Pane>>(() => ({
    orchestrator: makePane(usable, orchestrator ?? undefined),
    worker: makePane(usable),
  }));
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const restored = useRef(false);

  // Restore once after mount — chat survives navigation away and back.
  // Session ids are assigned here (not in render) to avoid an SSR mismatch.
  useEffect(() => {
    setPanes((prev) => {
      let base = prev;
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (s?.orchestrator && s?.worker) {
            base = {
              orchestrator: { ...s.orchestrator, sending: false },
              worker: { ...s.worker, sending: false },
            };
          }
        }
      } catch {
        /* ignore */
      }
      return {
        orchestrator: {
          ...base.orchestrator,
          sessionId: base.orchestrator.sessionId || newSessionId(),
        },
        worker: { ...base.worker, sessionId: base.worker.sessionId || newSessionId() },
      };
    });
    restored.current = true;
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(panes));
    } catch {
      /* ignore */
    }
  }, [panes]);

  function update(which: Which, partial: Partial<Pane>) {
    setPanes((prev) => ({ ...prev, [which]: { ...prev[which], ...partial } }));
  }

  function providerName(id: string) {
    return providers.find((p) => p.id === id)?.name ?? id;
  }

  async function sendMessage(which: Which, raw: string) {
    const text = raw.trim();
    if (!text) return;
    const pane = panesRef.current[which];
    if (!pane.providerId || !pane.model || pane.sending) return;

    const history =
      pane.mode === "isolated"
        ? []
        : pane.turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content }));

    setPanes((prev) => ({
      ...prev,
      [which]: {
        ...prev[which],
        turns: [...prev[which].turns, { role: "user", content: text }],
        input: "",
        sending: true,
      },
    }));

    try {
      const r = await providerChat(pane.providerId, {
        model: pane.model,
        message: text,
        history,
        session: `chat-${pane.sessionId}`,
      });
      setPanes((prev) => ({
        ...prev,
        [which]: {
          ...prev[which],
          turns: [
            ...prev[which].turns,
            {
              role: "assistant",
              content: r.reply || "(empty response)",
              tag: `${providerName(pane.providerId)} · ${r.model}`,
            },
          ],
          sending: false,
        },
      }));
    } catch (e) {
      setPanes((prev) => ({
        ...prev,
        [which]: {
          ...prev[which],
          turns: [
            ...prev[which].turns,
            {
              role: "assistant",
              content: e instanceof ApiError ? e.message : "request failed",
              tag: "error",
              error: true,
            },
          ],
          sending: false,
        },
      }));
    }
  }

  function relay(from: Which, text: string) {
    void sendMessage(from === "orchestrator" ? "worker" : "orchestrator", text);
  }

  function clearWindow(which: Which) {
    update(which, { visibleFrom: panesRef.current[which].turns.length });
  }

  function newSession(which: Which) {
    update(which, { turns: [], visibleFrom: 0, sessionId: newSessionId() });
  }

  if (usable.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center">
        <p className="mb-1 text-slate-300">No connected providers.</p>
        <p className="text-sm text-slate-500">Add and connect providers first.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <PaneView
        label="Orchestrator"
        hint="Monitors and delegates"
        icon={<Compass className="h-4 w-4" />}
        accent="violet"
        pane={panes.orchestrator}
        providerName={providerName(panes.orchestrator.providerId)}
        usable={usable}
        onProvider={(id) =>
          update("orchestrator", {
            providerId: id,
            model: usable.find((p) => p.id === id)?.models[0] ?? "",
          })
        }
        onModel={(m) => update("orchestrator", { model: m })}
        onMode={(m) => update("orchestrator", { mode: m })}
        onInput={(v) => update("orchestrator", { input: v })}
        onSend={() => sendMessage("orchestrator", panes.orchestrator.input)}
        onRelay={(t) => relay("orchestrator", t)}
        onClear={() => clearWindow("orchestrator")}
        onNewSession={() => newSession("orchestrator")}
        relayLabel="send to Worker"
      />
      <PaneView
        label="Worker"
        hint="Model under test"
        icon={<FlaskConical className="h-4 w-4" />}
        accent="teal"
        pane={panes.worker}
        providerName={providerName(panes.worker.providerId)}
        usable={usable}
        onProvider={(id) =>
          update("worker", {
            providerId: id,
            model: usable.find((p) => p.id === id)?.models[0] ?? "",
          })
        }
        onModel={(m) => update("worker", { model: m })}
        onMode={(m) => update("worker", { mode: m })}
        onInput={(v) => update("worker", { input: v })}
        onSend={() => sendMessage("worker", panes.worker.input)}
        onRelay={(t) => relay("worker", t)}
        onClear={() => clearWindow("worker")}
        onNewSession={() => newSession("worker")}
        relayLabel="send to Orchestrator"
      />
    </div>
  );
}

function PaneView({
  label,
  hint,
  icon,
  accent,
  pane,
  providerName,
  usable,
  onProvider,
  onModel,
  onMode,
  onInput,
  onSend,
  onRelay,
  onClear,
  onNewSession,
  relayLabel,
}: {
  label: string;
  hint: string;
  icon: React.ReactNode;
  accent: "violet" | "teal";
  pane: Pane;
  providerName: string;
  usable: Provider[];
  onProvider: (id: string) => void;
  onModel: (m: string) => void;
  onMode: (m: Mode) => void;
  onInput: (v: string) => void;
  onSend: () => void;
  onRelay: (text: string) => void;
  onClear: () => void;
  onNewSession: () => void;
  relayLabel: string;
}) {
  const models = usable.find((p) => p.id === pane.providerId)?.models ?? [];
  const head = accent === "violet" ? "text-violet-300" : "text-teal-300";
  const visible = pane.turns.slice(pane.visibleFrom);
  const memoryFile = pane.sessionId ? `chat-${pane.sessionId}.md` : "…";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-800">
      <div className="border-b border-slate-800 bg-slate-900/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={head}>{icon}</span>
          <span className={`text-sm font-semibold ${head}`}>{label}</span>
          <span className="text-[11px] text-slate-500">{hint}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <select
              className={selectCls}
              value={pane.providerId}
              onChange={(e) => onProvider(e.target.value)}
            >
              {usable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className={selectCls}
              value={pane.model}
              onChange={(e) => onModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-slate-600">
            session {pane.sessionId}
          </span>
          <select
            className={selectCls}
            value={pane.mode}
            onChange={(e) => onMode(e.target.value as Mode)}
            title="persisted = keeps conversation context · isolated = each message standalone"
          >
            <option value="persisted">persisted</option>
            <option value="isolated">isolated</option>
          </select>
          <button
            onClick={onClear}
            title="Clear the window — keeps the conversation context"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-600"
          >
            <Eraser className="h-3 w-3" />
            Clear
          </button>
          <button
            onClick={onNewSession}
            title="New session — wipes the context, fresh start"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-600"
          >
            <RotateCcw className="h-3 w-3" />
            New session
          </button>
          <Link
            href="/ai/memory"
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
            title={`This session is logged to vault/aiea-memory/chats/${memoryFile}`}
          >
            <Database className="h-3 w-3" />
            memory: chats/{memoryFile}
          </Link>
        </div>
      </div>

      <div className="h-[44vh] space-y-2.5 overflow-y-auto bg-slate-950/50 px-3 py-3">
        {visible.length === 0 && (
          <div className="text-xs text-slate-600">
            {pane.turns.length > 0 ? "Window cleared — context kept." : "No messages yet."}
          </div>
        )}
        {visible.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="ml-8 rounded-lg bg-slate-800/70 px-3 py-2 text-sm text-slate-200">
              {t.content}
            </div>
          ) : (
            <div key={i} className="mr-8">
              {t.tag && (
                <div
                  className={
                    "mb-0.5 text-[10px] uppercase tracking-wide " +
                    (t.error ? "text-red-400" : "text-slate-600")
                  }
                >
                  {t.tag}
                </div>
              )}
              <div
                className={
                  "whitespace-pre-wrap rounded-lg px-3 py-2 text-sm " +
                  (t.error
                    ? "bg-red-500/10 text-red-300"
                    : "bg-slate-900 text-slate-200 ring-1 ring-slate-800")
                }
              >
                {t.content}
              </div>
              {!t.error && (
                <button
                  onClick={() => onRelay(t.content)}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
                >
                  <ArrowLeftRight className="h-3 w-3" />
                  {relayLabel}
                </button>
              )}
            </div>
          ),
        )}
      </div>

      <div className="border-t border-slate-800 bg-slate-900/60 px-3 py-2">
        <div className="mb-1 text-[10px] text-slate-500">
          → sending to <span className={head}>{label}</span> · {providerName} · {pane.model}
        </div>
        <div className="flex items-center gap-2">
          <input
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-50"
            placeholder={`Message ${label}…`}
            value={pane.input}
            disabled={pane.sending}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />
          <button
            onClick={onSend}
            disabled={pane.sending || !pane.input.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {pane.sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <SendHorizonal className="h-3.5 w-3.5" />
            )}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
