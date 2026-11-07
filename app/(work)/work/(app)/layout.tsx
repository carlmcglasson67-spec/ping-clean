import type { ReactNode } from "react";
import { AppShell } from "@/components/ui/app-shell";
import { firstName, requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { WorkNav } from "../_components/work-nav";

export default async function WorkLayout({ children }: { children: ReactNode }) {
  const session = await requireRole("cleaner");
  const supabase = await createClient();
  const { data: me } = await supabase.from("cleaners").select("status").eq("id", session.userId).maybeSingle();
  // Applicants (and anyone whose row didn't load) get the application tabs only:
  // no job board or addresses until the Ping team approves them.
  const active = me?.status === "active";

  return (
    <AppShell area="/work" who={firstName(session)}>
      <WorkNav active={active} />
      {children}
    </AppShell>
  );
}
