"use client";

import { useEffect, useState } from "react";
import { PanelLeftOpen } from "lucide-react";

import { Sidebar } from "./Sidebar";
import { Orchestrator } from "./Orchestrator";

const KEY = "aiea:sidebar-collapsed";

export function Shell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(KEY) === "1") setCollapsed(true);
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar collapsed={collapsed} onToggle={toggle} />

      {collapsed && (
        <button
          onClick={toggle}
          title="Show sidebar"
          className="fixed left-3 top-3 z-50 rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-300 shadow-lg hover:text-slate-100"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}

      <div
        className="transition-[padding] duration-200"
        style={{ paddingLeft: collapsed ? "3.5rem" : "16rem" }}
      >
        <main className="mx-auto max-w-[1600px] p-6 lg:p-8">{children}</main>
      </div>

      <Orchestrator />
    </div>
  );
}
