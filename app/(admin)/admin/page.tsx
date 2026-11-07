import { Badge, Card, EmptyState, ErrorState, PageHeader, Stat } from "@/components/ui";
import { firstName, requireRole } from "@/lib/auth/session";
import { formatStamp, todayInLondon } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import type { Tables } from "@/lib/db/types";

// The numbers the marketplace can't run without. Booking stays off until all are set.
const REQUIRED_SETTINGS: { key: keyof Tables<"settings">; label: string }[] = [
  { key: "price_per_hour_pence", label: "Customer price per hour" },
  { key: "min_booking_minutes", label: "Minimum booking length" },
  { key: "commission_type", label: "Commission: percentage or per hour" },
  { key: "commission_value", label: "Commission amount" },
  { key: "top_window_minutes", label: "How long Top cleaners see a job first" },
  { key: "approved_window_minutes", label: "How long before it opens to everyone" },
  { key: "unclaimed_alert_minutes", label: "When to alert you about an unclaimed job" },
  { key: "dispute_window_hours", label: "Check period before a cleaner is paid" },
  { key: "launch_districts", label: "Launch postcode areas" },
];

const AUDIT_ENTITY: Record<string, string> = {
  settings: "Settings",
  cleaners: "Cleaner",
  cleaner_documents: "Document",
  series: "Regular clean",
  visits: "Visit",
  payments: "Payment",
  payouts: "Payout",
  visit_qc: "QC score",
  profiles: "Account role",
};

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default async function AdminHome() {
  const session = await requireRole("admin", "/admin");
  const supabase = await createClient();
  const today = todayInLondon();

  const [settings, applicants, pendingDocs, open, todays, activeCleaners, audit] = await Promise.all([
    supabase.from("settings").select("*").maybeSingle(),
    supabase.from("cleaners").select("id", { count: "exact", head: true }).eq("status", "applicant"),
    supabase.from("cleaner_documents").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("series").select("id, status").in("status", ["offering", "unclaimed"]),
    supabase.from("visits").select("id, status").eq("scheduled_date", today),
    supabase.from("cleaners").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("audit_log").select("id, action, entity, actor_id, created_at, detail").order("id", { ascending: false }).limit(8),
  ]);

  const failed = settings.error || applicants.error || pendingDocs.error || open.error || todays.error || activeCleaners.error || audit.error;
  if (failed) {
    return <ErrorState>The dashboard didn&rsquo;t load. Refresh, and if it keeps happening, check Supabase status.</ErrorState>;
  }

  const missing = REQUIRED_SETTINGS.filter(({ key }) => {
    const v = settings.data?.[key];
    return v === null || v === undefined || (Array.isArray(v) && v.length === 0);
  });
  const unclaimed = (open.data ?? []).filter((s) => s.status === "unclaimed").length;
  const offering = (open.data ?? []).filter((s) => s.status === "offering").length;
  const doneToday = (todays.data ?? []).filter((v) => v.status === "completed").length;

  return (
    <>
      <PageHeader eyebrow="Ping admin" title={`Today at Ping, ${firstName(session)}.`} lede="What needs you today, and the state of the marketplace." />

      {missing.length > 0 ? (
        <Card className="mb-8 bg-warn-soft ring-warn/25">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <h2 className="text-xl font-semibold">Booking is switched off until the numbers are set</h2>
              <p className="mt-2 text-ink-2">
                Ping never guesses a price. {missing.length} of {REQUIRED_SETTINGS.length} settings still need deciding (the open questions in the V1 spec).
              </p>
            </div>
            <Badge tone="warn">{missing.length} to set</Badge>
          </div>
          <ul className="mt-6 grid gap-2 sm:grid-cols-2">
            {missing.map((m) => (
              <li key={m.key} className="flex items-center gap-3 text-ink">
                <span className="size-2 rounded-full bg-warn" aria-hidden />
                {m.label}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <section aria-label="Needs you" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className={unclaimed ? "bg-bad-soft ring-bad/25" : undefined}>
          <Stat value={unclaimed} label="Unclaimed jobs" note={unclaimed ? "Assign these by hand" : "None waiting"} />
        </Card>
        <Card>
          <Stat value={offering} label="On offer now" note="Being shown to cleaners" />
        </Card>
        <Card>
          <Stat value={(applicants.count ?? 0) + (pendingDocs.count ?? 0)} label="Vetting queue" note={`${plural(applicants.count ?? 0, "applicant")} · ${plural(pendingDocs.count ?? 0, "document")}`} />
        </Card>
        <Card>
          <Stat value={`${doneToday}/${todays.data?.length ?? 0}`} label="Cleans done today" note={`${plural(activeCleaners.count ?? 0, "active cleaner")}`} />
        </Card>
      </section>

      <section aria-labelledby="activity" className="mt-12">
        <h2 id="activity" className="mb-4 text-xl font-semibold">Recent changes</h2>
        {(audit.data ?? []).length === 0 ? (
          <EmptyState title="Nothing logged yet">Every approval, assignment, refund and settings change will be recorded here.</EmptyState>
        ) : (
          <Card className="p-0 sm:p-0">
            <ol className="divide-y divide-line">
              {(audit.data ?? []).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-5 gap-y-1 px-6 py-4">
                  <span className="w-32 text-sm tabular text-ink-3">{formatStamp(a.created_at)}</span>
                  <span className="font-semibold">{AUDIT_ENTITY[a.entity] ?? a.entity}</span>
                  <span className="text-ink-2">{a.action === "insert" ? "created" : a.action === "delete" ? "removed" : `changed: ${Object.keys((a.detail ?? {}) as object).join(", ") || "details"}`}</span>
                  {!a.actor_id ? <Badge className="ml-auto">System</Badge> : null}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </section>
    </>
  );
}
