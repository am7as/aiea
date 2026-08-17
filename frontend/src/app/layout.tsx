import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";

export const metadata: Metadata = {
  title: "AIEA — AI Exam Assistant",
  description: "Generate, evaluate, and refine exam questions from course materials.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      {/* suppressHydrationWarning: some browser extensions (Grammarly, password
          managers, etc.) inject attributes on <body> before React hydrates,
          which triggers a hydration mismatch we can't control. Skipping the
          warning on this single element only. */}
      <body className="bg-background text-foreground antialiased" suppressHydrationWarning>{children}</body>
    </html>
  );
}
