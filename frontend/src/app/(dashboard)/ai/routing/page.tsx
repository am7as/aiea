import { TopBar } from "@/components/TopBar";
import { api, type Provider, type TaskRoute } from "@/lib/api";
import { RoutingPanel } from "./RoutingPanel";

export const dynamic = "force-dynamic";

async function load(): Promise<{ routes: TaskRoute[]; providers: Provider[] }> {
  const [routes, providers] = await Promise.all([
    api<TaskRoute[]>("/ai/task-routes").catch(() => [] as TaskRoute[]),
    api<Provider[]>("/ai/providers").catch(() => [] as Provider[]),
  ]);
  return { routes, providers };
}

export default async function RoutingPage() {
  const { routes, providers } = await load();
  return (
    <>
      <TopBar
        title="Task Routing"
        subtitle="Every AI task runs through a route — a provider, a model, and params. Unrouted tasks fall back to the Default route."
      />
      <RoutingPanel initialRoutes={routes} providers={providers} />
    </>
  );
}
