"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";

import { api, ApiError } from "@/lib/api";

export function DeleteCourseButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (busy) return;
    const ok = window.confirm(
      `Delete course "${title}"? This also removes all materials, questions, and exams under it.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api<void>(`/courses/${id}`, { method: "DELETE" });
      router.push("/courses");
      router.refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Delete failed";
      window.alert(msg);
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-50 text-rose-300 text-sm font-medium transition-colors"
    >
      <Trash2 className="h-4 w-4" />
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
