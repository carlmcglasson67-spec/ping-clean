import type { Metadata } from "next";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatStamp } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { TeamPanel, type TeamChange, type TeamMember } from "./team-panel";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const session = await requireRole("admin", "/admin/team");
  const supabase = await createClient();
  const [team, log] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, created_at").eq("role", "admin").order("created_at"),
    supabase.from("team_changes").select("id, profile_id, made_admin, reason, actor_id, created_at").order("created_at", { ascending: false }).limit(10),
  ]);

  // Names for the log: whoever acted and whoever it was about, from profiles admins can read.
  const ids = [...new Set((log.data ?? []).flatMap((r) => [r.actor_id, r.profile_id]))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
    for (const p of data ?? []) names.set(p.id, p.full_name?.trim() || p.email || "Someone");
  }

  const members: TeamMember[] = (team.data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name?.trim() || "No name given",
    email: p.email ?? "",
    you: p.id === session.userId,
  }));
  const changes: TeamChange[] | null = log.error
    ? null
    : (log.data ?? []).map((r) => ({
        id: String(r.id),
        made: r.made_admin,
        who: names.get(r.profile_id) ?? "An account",
        by: names.get(r.actor_id) ?? "Someone",
        reason: r.reason,
        when: formatStamp(r.created_at),
      }));

  return (
    <>
      <PageHeader
        eyebrow="Team"
        title="Who runs Ping."
        lede="Admins see every customer, cleaner and payment. Add someone only once they've signed up with their own email and chosen their password from the link we sent them."
      />
      {team.error ? (
        <ErrorState title="The team didn't load">Refresh the page. Nothing has been changed.</ErrorState>
      ) : members.length === 0 ? (
        <EmptyState title="No admins found">Refresh the page.</EmptyState>
      ) : (
        <TeamPanel members={members} changes={changes} />
      )}
    </>
  );
}
