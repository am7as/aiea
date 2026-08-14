import { TopBar } from "@/components/TopBar";
import { api, type Provider, type TaskRoute } from "@/lib/api";
import { ChatPanel } from "./ChatPanel";

export const dynamic = "force-dynamic";

async function load(): Promise<{
  providers: Provider[];
  orchestrator: { providerId: string; model: string } | null;
}> {
  const [providers, routes] = await Promise.all([
    api<Provider[]>("/ai/providers").catch(() => [] as Provider[]),
    api<TaskRoute[]>("/ai/task-routes").catch(() => [] as TaskRoute[]),
  ]);
  const orch = routes.find((r) => r.task === "orchestration");
  const primary = orch?.models.find((m) => m.role === "primary");
  return {
    providers,
    orchestrator: primary ? { providerId: primary.provider_id, model: primary.model } : null,
  };
}

export default async function ChatPage() {
  const { providers, orchestrator } = await load();
  return (
    <>
      <TopBar
        title="Chat"
        subtitle="Two AIs side by side — an Orchestrator that monitors and delegates, and a Worker model under test. Relay a reply to the other pane to pass messages AI-to-AI."
      />
      <ChatPanel providers={providers} orchestrator={orchestrator} />
    </>
  );
}
