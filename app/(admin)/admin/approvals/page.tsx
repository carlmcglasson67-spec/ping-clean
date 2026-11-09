import type { Metadata, Route } from "next";
import Link from "next/link";
import { Badge, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatStamp, todayInLondon } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { readAll, readByIds, ROW_CAP } from "../_lib/read-all";
import { DOCUMENT_KIND, TIER } from "@/lib/labels";
import { readiness, type DocRow } from "./_lib/vetting";

export const metadata: Metadata = { title: "Approvals" };

type Person = { id: string; status: string; tier: keyof typeof TIER; areas: string[]; created_at: string; name: string; docs: DocRow[] };

export default async function ApprovalsPage() {
  await requireRole("admin", "/admin/approvals");
  const supabase = await createClient();
  const today = todayInLondon();

  // Every cleaner and document, in keyset pages (no 1,000-row cap); oldest application first.
  const [cleanersAll, docs] = await Promise.all([
    readAll((after) => {
      const q = supabase.from("cleaners").select("id, status, tier, areas, created_at").order("id").limit(ROW_CAP);
      return after ? q.gt("id", after) : q;
    }, "id"),
    readAll((after) => {
      const q = supabase.from("cleaner_documents").select("id, cleaner_id, kind, status, expires_on, created_at").order("id").limit(ROW_CAP);
      return after ? q.gt("id", after) : q;
    }, "id"),
  ]);
  const cleaners = { ...cleanersAll, data: cleanersAll.data?.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)) ?? null };
  const ids = (cleaners.data ?? []).map((c) => c.id);
  const profiles = await readByIds(ids, (slice) => supabase.from("profiles").select("id, full_name, email").in("id", slice));

  if (cleaners.error || docs.error || profiles.error) {
    return (
      <>
        <PageHeader eyebrow="Approvals" title="Vetting new cleaners." />
        <ErrorState title="The vetting queue didn't load">Refresh the page. If it keeps happening, check the Supabase status page.</ErrorState>
      </>
    );
  }

  const nameOf = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name?.trim() || p.email || "Unnamed cleaner"]));
  const people: Person[] = (cleaners.data ?? []).map((c) => ({
    ...c,
    name: nameOf.get(c.id) ?? "Unnamed cleaner",
    docs: (docs.data ?? []).filter((d) => d.cleaner_id === c.id),
  }));
  const applicants = people.filter((p) => p.status === "applicant");
  const renewals = people.filter((p) => p.status !== "applicant" && readiness(p.docs, today).toCheck > 0);
  const team = people.filter((p) => p.status === "active" || p.status === "suspended");

  return (
    <>
      <PageHeader
        eyebrow="Approvals"
        title="Vetting new cleaners."
        lede="Open each document through a short-lived link, verify it or send it back with a reason, then decide. Every step is logged."
      />

      <section aria-labelledby="applicants" className="grid gap-4">
        <Heading id="applicants" title="Applicants" count={applicants.length} />
        {applicants.length === 0 ? (
          <EmptyState title="Nobody waiting">New applicants appear here as soon as they apply in the cleaner app.</EmptyState>
        ) : (
          <List people={applicants} today={today} />
        )}
      </section>

      {renewals.length > 0 ? (
        <section aria-labelledby="renewals" className="mt-12 grid gap-4">
          <Heading id="renewals" title="New documents from working cleaners" count={renewals.length} />
          <List people={renewals} today={today} />
        </section>
      ) : null}

      <section aria-labelledby="team" className="mt-12 grid gap-4">
        <Heading id="team" title="The team" count={team.length} />
        {team.length === 0 ? (
          <EmptyState title="No approved cleaners yet">Approved cleaners appear here, with their tier, so you can change it or suspend someone.</EmptyState>
        ) : (
          <List people={team} today={today} />
        )}
      </section>
    </>
  );
}

function Heading({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 id={id} className="text-xl font-semibold">{title}</h2>
      <span className="font-display text-xl font-semibold text-navy-3 tabular">{count}</span>
    </div>
  );
}

function List({ people, today }: { people: Person[]; today: string }) {
  return (
    <ul className="grid gap-3">
      {people.map((p) => {
        const r = readiness(p.docs, today);
        return (
          <li key={p.id}>
            <Link
              href={`/admin/approvals/${p.id}` as Route}
              className="group grid gap-3 rounded-lg bg-card p-5 shadow-card ring-1 ring-line/70 transition-shadow hover:shadow-lift sm:grid-cols-[1.2fr_1fr_auto] sm:items-center sm:gap-6 sm:p-6"
            >
              <div className="grid gap-1">
                <span className="text-lg font-semibold group-hover:text-blue">{p.name}</span>
                <span className="text-sm text-navy-3">
                  {p.status === "applicant" ? `Applied ${formatStamp(p.created_at)}` : `${TIER[p.tier]} tier`}
                  {p.areas.length ? ` · ${p.areas.join(", ")}` : " · no areas chosen"}
                </span>
              </div>
              <div className={p.status === "applicant" || r.ready ? "text-sm text-navy-2" : "text-sm font-semibold text-warn"}>
                {r.ready
                  ? "All four checks verified"
                  : `${p.status === "applicant" ? "Waiting on" : "Paperwork gaps:"} ${r.waiting.map((k) => DOCUMENT_KIND[k]).join(", ")}`}
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {p.status === "suspended" ? <Badge tone="bad">Suspended</Badge> : null}
                {r.toCheck ? <Badge tone="warn">{r.toCheck} to check</Badge> : null}
                {p.status === "applicant" && r.ready ? <Badge tone="ok">Ready to approve</Badge> : null}
                {p.status === "active" ? <Badge tone="ok">Working</Badge> : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
