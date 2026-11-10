import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/ui/app-shell";
import { firstName, requireRole } from "@/lib/auth/session";
import { AdminNav } from "./_components/admin-nav";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Ping admin" }, robots: { index: false } };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireRole("admin");
  return (
    <AppShell area="/admin" who={firstName(session)}>
      <AdminNav />
      {children}
    </AppShell>
  );
}
