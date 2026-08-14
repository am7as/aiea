"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  FolderOpen,
  FileText,
  HelpCircle,
  MessagesSquare,
  Cpu,
  Brain,
  Sparkles,
  Database,
  Workflow,
  Activity,
  ListChecks,
  LibraryBig,
  Settings,
  PanelLeftClose,
  Boxes,
  GraduationCap,
  FileSpreadsheet,
  Archive,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/cn";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
};

const overview: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/courses", label: "Courses", icon: BookOpen },
  { href: "/workspace", label: "Workspace", icon: FolderOpen },
  { href: "/materials", label: "Materials", icon: FileText },
];

const ai: NavItem[] = [
  { href: "/ai/chat", label: "Chat", icon: MessagesSquare },
  { href: "/ai/tasks", label: "Tasks", icon: ListChecks },
  { href: "/ai/providers", label: "Providers", icon: Cpu },
  { href: "/ai/routing", label: "Task Routing", icon: Brain },
  { href: "/ai/memory", label: "Memory", icon: Database },
  { href: "/ai/canvas", label: "Canvas", icon: Workflow },
  { href: "/ai/skills", label: "Skills", icon: Sparkles },
];

const system: NavItem[] = [
  { href: "/monitoring", label: "Monitoring", icon: Activity },
  { href: "/docs", label: "Docs", icon: LibraryBig },
];

function courseNav(id: string): NavItem[] {
  return [
    { href: `/courses/${id}`, label: "Overview", icon: LayoutDashboard, exact: true },
    { href: `/courses/${id}/extraction`, label: "Extraction", icon: Boxes },
    { href: `/courses/${id}/syllabus`, label: "Course Map", icon: GraduationCap },
    { href: `/courses/${id}/exam-plan`, label: "Question Generation", icon: Sparkles },
    { href: `/courses/${id}/questions`, label: "Question Bank", icon: HelpCircle },
    { href: `/courses/${id}/exam-builder`, label: "Exam Builder", icon: FileSpreadsheet },
    { href: `/courses/${id}/exam-bank`, label: "Exam Bank", icon: Archive },
    { href: `/courses/${id}/validation`, label: "Validation", icon: ShieldCheck },
  ];
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavSection({
  title,
  items,
  pathname,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <div className="mb-6">
      <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </div>
      <nav className="space-y-0.5">
        {items.map((it) => {
          const active = isActive(pathname, it);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 mx-2 rounded-xl text-sm transition-colors",
                active
                  ? "bg-slate-800/60 text-slate-100 border-l-2 border-blue-500 pl-[10px]"
                  : "text-slate-400 hover:text-slate-100 hover:bg-slate-900/60",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{it.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

// The open-course section stays visible across AI Engine / System pages:
// the last course you opened is remembered until you open another.
function useStickyCourseId(pathname: string): string | null {
  const m = pathname.match(/^\/courses\/([^/]+)/);
  const fromPath = m && m[1] !== "new" ? m[1] : null;
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => {
    if (fromPath) {
      localStorage.setItem("aiea:open-course", fromPath);
      setRemembered(fromPath);
    } else {
      setRemembered(localStorage.getItem("aiea:open-course"));
    }
  }, [fromPath]);
  return fromPath ?? remembered;
}

export function Sidebar({
  collapsed = false,
  onToggle,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const pathname = usePathname();
  const courseId = useStickyCourseId(pathname);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 w-64 bg-slate-950 border-r border-slate-800/80 flex flex-col transition-transform duration-200",
        collapsed ? "-translate-x-full" : "translate-x-0",
      )}
    >
      <div className="px-5 py-5 border-b border-slate-800/80 flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center font-bold text-white">
          E
        </div>
        <div className="leading-tight">
          <div className="font-semibold text-slate-100">AIEA</div>
          <div className="text-[11px] text-slate-500">v0.1.0 · single user</div>
        </div>
        <button
          onClick={onToggle}
          title="Hide sidebar"
          className="ml-auto text-slate-500 hover:text-slate-200"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-5">
        <NavSection title="Overview" items={overview} pathname={pathname} />
        {courseId && (
          <NavSection title="Open course" items={courseNav(courseId)} pathname={pathname} />
        )}
        <NavSection title="AI Engine" items={ai} pathname={pathname} />
        <NavSection title="System" items={system} pathname={pathname} />
      </div>

      <div className="border-t border-slate-800/80 p-4">
        <Link
          href="/settings"
          className="flex items-center gap-3 text-sm text-slate-400 hover:text-slate-100"
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </aside>
  );
}
