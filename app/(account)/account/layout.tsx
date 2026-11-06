import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/ui/app-shell";
import { firstName, requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "My cleans", robots: { index: false } };

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const session = await requireRole("customer");
  return (
    <AppShell area="/account" who={session.fullName ?? firstName(session)}>
      {children}
    </AppShell>
  );
}
