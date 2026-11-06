import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/ui/app-shell";
import { firstName, requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Cleaner", robots: { index: false } };

export default async function WorkLayout({ children }: { children: ReactNode }) {
  const session = await requireRole("cleaner");
  return (
    <AppShell area="/work" who={firstName(session)}>
      {children}
    </AppShell>
  );
}
