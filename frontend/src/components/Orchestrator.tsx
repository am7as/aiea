"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bot, X, Send, Loader2, Trash2 } from "lucide-react";

import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { ApiError, orchestratorChat, type OrchestratorMsg } from "@/lib/api";

const KEY = "aiea:orchestrator";

export function Orchestrator() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<OrchestratorMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      if (s) setMsgs(JSON.parse(s));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(msgs));
  }, [msgs]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, busy]);

  const courseMatch = pathname.match(/^\/courses\/([^/]+)/);
  const courseId = courseMatch && courseMatch[1] !== "new" ? courseMatch[1] : null;

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const history = msgs;
    setMsgs([...history, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    setErr(null);
    try {
      const r = await orchestratorChat({ message: text, history, course_id: courseId, page: pathname });
      setMsgs((m) => [...m, { role: "assistant", content: r.reply }]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Orchestrator failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Orchestrator"
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-lg transition-transform hover:scale-105"
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[72vh] w-[400px] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
          <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
            <Bot className="h-4 w-4 text-violet-400" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-100">Orchestrator</div>
              <div className="truncate text-[11px] text-slate-500">
                operates AIEA — ask it to do things
              </div>
            </div>
            <button
              onClick={() => setMsgs([])}
              title="Clear conversation"
              className="text-slate-500 hover:text-slate-300"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {msgs.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-4 text-xs leading-relaxed text-slate-500">
                Ask me to run things — &ldquo;AI-extract the lecture slides&rdquo;,
                &ldquo;generate 10 MCQs for this course&rdquo;, &ldquo;build the syllabus&rdquo;,
                &ldquo;what failed extraction?&rdquo;. I drive AIEA for you.
              </div>
            )}
            {msgs.map((m, i) => (
              <Bubble key={i} msg={m} />
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> working…
              </div>
            )}
            {err && <div className="text-xs text-red-400">{err}</div>}
          </div>

          <div className="border-t border-slate-800 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                placeholder="Ask the orchestrator…"
                className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={send}
                disabled={busy || !input.trim()}
                className="rounded-lg bg-blue-500 p-2 text-white hover:bg-blue-600 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Bubble({ msg }: { msg: OrchestratorMsg }) {
  if (msg.role === "user") {
    return (
      <div className="ml-10 rounded-xl bg-blue-600/20 px-3 py-2 text-xs leading-relaxed text-slate-100">
        {msg.content}
      </div>
    );
  }
  return (
    <div className="mr-6 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs leading-relaxed text-slate-200">
      <MarkdownRenderer markdown={msg.content} />
    </div>
  );
}
