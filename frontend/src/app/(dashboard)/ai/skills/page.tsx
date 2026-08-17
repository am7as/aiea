import { TopBar } from "@/components/TopBar";
import { SkillsPanel } from "./SkillsPanel";

export const dynamic = "force-dynamic";

export default function SkillsPage() {
  return (
    <>
      <TopBar
        title="Skills & Tools"
        subtitle="Everything AIEA can do, in one inventory: runtime skills the AI loads as prompt fragments, the catalogue of AI tasks and which provider serves each, the ARQ worker jobs, and every API route the backend exposes."
      />
      <SkillsPanel />
    </>
  );
}
