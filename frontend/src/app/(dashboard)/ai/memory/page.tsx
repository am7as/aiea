import { TopBar } from "@/components/TopBar";
import { api, type MemoryOverview } from "@/lib/api";
import { MemoryPanel } from "./MemoryPanel";

export const dynamic = "force-dynamic";

async function load(): Promise<{
  overview: MemoryOverview;
  tags: Record<string, number>;
  sessions: string[];
}> {
  const empty: MemoryOverview = {
    root: "",
    sessions: 0,
    headers: 0,
    tag_count: 0,
    generated: null,
  };
  const [overview, tagsRes, sessions] = await Promise.all([
    api<MemoryOverview>("/memory/overview").catch(() => empty),
    api<{ counts: Record<string, number> }>("/memory/tags").catch(() => ({ counts: {} })),
    api<string[]>("/memory/sessions").catch(() => [] as string[]),
  ]);
  return { overview, tags: tagsRes.counts, sessions };
}

export default async function MemoryPage() {
  const { overview, tags, sessions } = await load();
  return (
    <>
      <TopBar
        title="Memory"
        subtitle="Tagged session logs — every AI exchange is recorded as markdown with hierarchical #tags, so the AI can recall by tag instead of re-reading everything."
      />
      <MemoryPanel overview={overview} tags={tags} sessions={sessions} />
    </>
  );
}
