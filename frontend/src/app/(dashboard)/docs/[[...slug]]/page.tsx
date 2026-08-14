import { notFound } from "next/navigation";

import { ApiError, fetchDocsFile, fetchDocsTree, type DocsTree } from "@/lib/api";
import { DocsShell } from "./DocsShell";

export const dynamic = "force-dynamic";

async function loadTree(): Promise<DocsTree | null> {
  try {
    return await fetchDocsTree();
  } catch {
    return null;
  }
}

async function loadMarkdown(path: string): Promise<string | null> {
  try {
    return await fetchDocsFile(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

const DEFAULT_DOC = "guide/README.md";

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const tree = await loadTree();

  let activePath: string;
  if (!slug || slug.length === 0) {
    activePath = DEFAULT_DOC;
  } else {
    const joined = slug.join("/");
    // Try the path as-is, then with .md appended
    activePath = joined.endsWith(".md") ? joined : `${joined}.md`;
  }

  const markdown = await loadMarkdown(activePath);
  if (markdown === null && (!slug || slug.length === 0)) {
    // README.md fallback chain when the default doesn't exist
    const alt = "setup.md";
    const altMd = await loadMarkdown(alt);
    if (altMd !== null) {
      return <DocsShell tree={tree} activePath={alt} markdown={altMd} />;
    }
  }
  if (markdown === null) notFound();

  return <DocsShell tree={tree} activePath={activePath} markdown={markdown!} />;
}
