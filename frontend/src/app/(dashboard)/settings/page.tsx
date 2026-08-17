import { TopBar } from "@/components/TopBar";
import { SettingsPanel } from "./SettingsPanel";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <>
      <TopBar
        title="Settings"
        subtitle="Cross-cutting controls and quick links to the rest of the system. AIEA is single-user and localhost — no auth, no remote sync."
      />
      <SettingsPanel />
    </>
  );
}
