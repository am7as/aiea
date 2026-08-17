"use client";

import { useEffect, useRef, useState } from "react";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const m = mod.default;
      m.initialize({
        startOnLoad: false,
        theme: "base",
        securityLevel: "loose",
        fontFamily: "Inter, system-ui, sans-serif",
        flowchart: { useMaxWidth: true, htmlLabels: true, curve: "basis" },
        sequence: { useMaxWidth: true, mirrorActors: false, actorMargin: 60, messageAlign: "center" },
        themeVariables: {
          background: "transparent",
          primaryColor: "transparent",
          primaryTextColor: "#e2e8f0",
          primaryBorderColor: "#64748b",
          secondaryColor: "transparent",
          secondaryTextColor: "#cbd5e1",
          secondaryBorderColor: "#475569",
          tertiaryColor: "transparent",
          tertiaryTextColor: "#cbd5e1",
          tertiaryBorderColor: "#475569",
          lineColor: "#64748b",
          textColor: "#e2e8f0",
          edgeLabelBackground: "#0f172a",
          actorBkg: "transparent",
          actorBorder: "#3b82f6",
          actorTextColor: "#e2e8f0",
          actorLineColor: "#475569",
          signalColor: "#94a3b8",
          signalTextColor: "#e2e8f0",
          labelBoxBkgColor: "transparent",
          labelBoxBorderColor: "#475569",
          labelTextColor: "#e2e8f0",
          loopTextColor: "#cbd5e1",
          noteBkgColor: "transparent",
          noteBorderColor: "#3b82f6",
          noteTextColor: "#e2e8f0",
          activationBkgColor: "#1e293b",
          activationBorderColor: "#3b82f6",
          sequenceNumberColor: "#e2e8f0",
          clusterBkg: "transparent",
          clusterBorder: "#334155",
          titleColor: "#94a3b8",
        },
      });
      return m;
    });
  }
  return mermaidPromise;
}

function removeOrphans(id: string) {
  if (typeof document === "undefined") return;
  document.getElementById(`d${id}`)?.remove();
  const direct = document.getElementById(id);
  if (direct && direct.parentElement === document.body) direct.remove();
}

export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Random id per effect invocation. Two reasons:
    //  1. React StrictMode (dev) double-renders; a stable id would let the
    //     second mount's cleanup destroy what the first mount's in-flight
    //     mermaid.render() is reading, causing "firstChild of null".
    //  2. Multiple Mermaid blocks on a page must have distinct ids.
    const renderId = `mm-${Math.random().toString(36).slice(2, 10)}`;

    (async () => {
      try {
        const m = await loadMermaid();
        if (cancelled) return;
        const { svg } = await m.render(renderId, chart);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "render failed");
      } finally {
        // Only after render finishes (success or fail). Never before or on
        // unmount — that races against the in-flight render.
        removeOrphans(renderId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return (
      <pre className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 text-xs text-rose-300 whitespace-pre-wrap my-4">
        Mermaid error: {error}
        {"\n\n"}
        {chart}
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      className="my-4 flex justify-center rounded-xl border border-slate-800 bg-slate-950/40 p-4 overflow-auto [&_svg]:max-w-full [&_svg]:h-auto"
    />
  );
}
