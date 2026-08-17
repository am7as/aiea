import { TopBar } from "@/components/TopBar";
import { MonitoringPanel } from "./MonitoringPanel";

export const dynamic = "force-dynamic";

export default function MonitoringPage() {
  return (
    <>
      <TopBar
        title="Monitoring"
        subtitle="AI usage across providers and models — message counts, token totals, cost (when reported by the provider), and 24-hour activity. Every routed call is counted here, background jobs included. The conversation text itself is written to vault/aiea-memory/ and is readable under AI → Memory."
      />
      <MonitoringPanel />
    </>
  );
}
