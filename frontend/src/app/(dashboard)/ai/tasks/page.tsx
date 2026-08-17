import { TopBar } from "@/components/TopBar";
import { TasksPanel } from "./TasksPanel";

export const dynamic = "force-dynamic";

export default function TasksPage() {
  return (
    <>
      <TopBar
        title="AI Tasks"
        subtitle="Live view of all AI work — queued, running, and recently completed. Cancel in-flight jobs or retry failed ones. The panel polls every 3 seconds while you're on the page."
      />
      <TasksPanel />
    </>
  );
}
