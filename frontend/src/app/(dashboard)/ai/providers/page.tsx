import { TopBar } from "@/components/TopBar";
import { api, type Provider } from "@/lib/api";
import { ProvidersPanel } from "./ProvidersPanel";

export const dynamic = "force-dynamic";

async function load(): Promise<Provider[]> {
  try {
    return await api<Provider[]>("/ai/providers");
  } catch {
    return [];
  }
}

export default async function ProvidersPage() {
  const providers = await load();
  return (
    <>
      <TopBar
        title="AI Providers"
        subtitle="Connect the models AIEA can use — subscription CLIs, token APIs, and local LM Studio / Ollama servers. Add as many as you like, test each, then connect the healthy ones."
      />
      <ProvidersPanel initial={providers} />
    </>
  );
}
