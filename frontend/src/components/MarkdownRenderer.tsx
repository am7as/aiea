"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import Link from "next/link";

import { Mermaid } from "@/components/Mermaid";

function rewriteDocsHref(href: string): { href: string; internal: boolean } {
  if (!href) return { href, internal: false };
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return { href, internal: false };
  }
  if (href.startsWith("#")) return { href, internal: false };
  // Strip trailing slash for normalization
  let h = href.replace(/\/$/, "");
  // .md → bare path for docs viewer
  // Resolve "../" by letting browser handle it via in-doc link
  h = h.replace(/\.md(#|$)/, "$1");
  if (!h.startsWith("/")) {
    // Treat as relative to /docs/
    h = `/docs/${h}`;
  }
  return { href: h, internal: true };
}

type HastTextNode = { type: "text"; value: string };
type HastElementNode = { type: string; children?: Array<HastTextNode | HastElementNode> };

function rawTextFromHastNode(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as HastElementNode;
  if (n.type === "text" && typeof (n as unknown as HastTextNode).value === "string") {
    return (n as unknown as HastTextNode).value;
  }
  if (Array.isArray(n.children)) {
    return n.children.map(rawTextFromHastNode).join("");
  }
  return "";
}

const components: Components = {
  code({ className, children, node, ...rest }) {
    const lang = (className ?? "").match(/language-(\w+)/)?.[1];
    if (lang === "mermaid") {
      const raw = rawTextFromHastNode(node) || String(children);
      return <Mermaid chart={raw.trim()} />;
    }
    const inline = !className;
    if (inline) {
      return (
        <code className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-200 text-[0.9em] font-mono" {...rest}>
          {children}
        </code>
      );
    }
    return (
      <pre className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 overflow-x-auto text-xs my-4">
        <code className={className} {...rest}>
          {children}
        </code>
      </pre>
    );
  },
  a({ href, children, ...rest }) {
    if (!href) return <a {...rest}>{children}</a>;
    const { href: rewritten, internal } = rewriteDocsHref(href);
    if (internal && rewritten.startsWith("/docs/")) {
      return (
        <Link href={rewritten} className="text-blue-400 hover:text-blue-300 underline decoration-slate-700 underline-offset-2">
          {children}
        </Link>
      );
    }
    return (
      <a
        href={rewritten}
        className="text-blue-400 hover:text-blue-300 underline decoration-slate-700 underline-offset-2"
        target={rewritten.startsWith("http") ? "_blank" : undefined}
        rel="noreferrer"
        {...rest}
      >
        {children}
      </a>
    );
  },
  h1: (p) => <h1 className="text-2xl font-semibold tracking-tight text-slate-100 mt-2 mb-4" {...p} />,
  h2: (p) => <h2 className="text-xl font-semibold tracking-tight text-slate-100 mt-8 mb-3 pb-1 border-b border-slate-800" {...p} />,
  h3: (p) => <h3 className="text-base font-semibold text-slate-100 mt-6 mb-2" {...p} />,
  h4: (p) => <h4 className="text-sm font-semibold text-slate-200 mt-4 mb-2" {...p} />,
  p: (p) => <p className="text-sm text-slate-300 leading-relaxed my-3" {...p} />,
  ul: (p) => <ul className="list-disc pl-6 my-3 text-sm text-slate-300 space-y-1" {...p} />,
  ol: (p) => <ol className="list-decimal pl-6 my-3 text-sm text-slate-300 space-y-1" {...p} />,
  li: (p) => <li className="leading-relaxed" {...p} />,
  blockquote: (p) => (
    <blockquote
      className="border-l-2 border-blue-500/60 bg-slate-900/40 pl-4 py-2 my-4 text-sm text-slate-400 italic"
      {...p}
    />
  ),
  hr: () => <hr className="my-6 border-slate-800" />,
  table: (p) => (
    <div className="overflow-x-auto my-4">
      <table className="text-sm border-collapse border border-slate-800 w-full" {...p} />
    </div>
  ),
  thead: (p) => <thead className="bg-slate-900/60" {...p} />,
  th: (p) => <th className="border border-slate-800 px-3 py-2 text-left text-xs font-semibold text-slate-200" {...p} />,
  td: (p) => <td className="border border-slate-800 px-3 py-2 text-slate-300 align-top" {...p} />,
  strong: (p) => <strong className="text-slate-100 font-semibold" {...p} />,
  em: (p) => <em className="text-slate-200" {...p} />,
  img: ({ src, alt }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={typeof src === "string" ? src : ""}
      alt={typeof alt === "string" ? alt : ""}
      className="my-4 max-w-full rounded-lg border border-slate-800 bg-white"
    />
  ),
};

export function MarkdownRenderer({ markdown }: { markdown: string }) {
  return (
    <div className="prose-aiea max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
