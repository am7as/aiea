import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-xl text-center">
        <div className="mx-auto mb-6 h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-2xl font-bold text-white">
          E
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-2">AIEA</h1>
        <p className="text-slate-400 mb-8">
          Single-user exam assistant. Phase 0 scaffold — the dashboard lands in
          Phase 1.
        </p>
        <div className="flex justify-center gap-3 text-sm">
          <a
            href="http://localhost:4021/docs"
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800"
          >
            API docs
          </a>
          <Link
            href="/dashboard"
            className="px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
