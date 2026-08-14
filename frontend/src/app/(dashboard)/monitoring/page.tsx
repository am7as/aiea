import { TopBar } from "@/components/TopBar";
import { MonitoringPanel } from "./MonitoringPanel";

export const dynamic = "force-dynamic";

export default function MonitoringPage() {
  return (
    <>
      <TopBar
        title="Monitoring"
        subtitle="AI usage across providers and models — message counts, token totals, cost (when reported by the provider), and 24-hour activity. Worker-side AI calls write logs to vault/aiea-memory/ — those are visible under AI → Memory; chat / orchestrator calls also write tokens here."
      />
      <MonitoringPanel />
    </>
  );
}
