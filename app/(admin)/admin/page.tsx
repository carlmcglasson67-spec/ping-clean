import type { Metadata } from "next";
import { Badge, Card, EmptyState, ErrorState, NavyPanel, PageHeader } from "@/components/ui";
import { firstName, requireRole } from "@/lib/auth/session";
import { formatDay, formatStamp, todayInLondon } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { ALERT_KIND, ALERT_ORDER, alertKind, type AlertKind } from "./_lib/alerts";
import { auditEntity, auditSummary } from "./_lib/audit";
import { REQUIRED_SETTINGS, missingSettings } from "./_lib/required-settings";
import { SectionCard } from "./_components/section-card";

export const metadata: Metadata = { title: "Overview" };

function plural(n: number, word: string, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

export default async function AdminHome() {
  const session = await requireRole("admin", "/admin");
  const supabase = await createClient();
  const today = todayInLondon();

  const [settings, applicants, pendingDocs, open, todays, alerts, done, scored, audit] = await Promise.all([
    supabase.from("settings").select("*").maybeSingle(),
    supabase.from("cleaners").select("id", { count: "exact", head: true }).eq("status", "applicant"),
    supabase.from("cleaner_documents").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("series").select("id, status").in("status", ["offering", "unclaimed"]),
    supabase.from("visits").select("id, status").eq("scheduled_date", today),
    supabase.from("engine_alerts").select("id, kind").is("resolved_at", null),
    supabase.from("visits").select("id").eq("status", "completed").order("completed_at", { ascending: false }).limit(500),
    supabase.from("visit_qc").select("visit_id"),
    supabase.from("audit_log").select("id, action, entity, actor_id, actor_label, created_at, detail").order("id", { ascending: false }).limit(8),
  ]);

  const failed = settings.error || applicants.error || pendingDocs.error || open.error || todays.error || alerts.error || done.error || scored.error || audit.error;
  if (failed) {
    return (
      <>
        <PageHeader eyebrow="Ping admin" title={`Today at Ping, ${firstName(session)}.`} />
        <ErrorState title="The overview didn't load">Refresh the page. If it keeps happening, check the Supabase status page.</ErrorState>
      </>
    );
  }

  // Who on the team did each change (first names only; the log itself stores ids).
  const actorIds = [...new Set((audit.data ?? []).map((a) => a.actor_id).filter((id): id is string => !!id))];
  const actors = actorIds.length ? await supabase.from("profiles").select("id, full_name").in("id", actorIds) : { data: [] };
  const actorName = new Map((actors.data ?? []).map((p) => [p.id, p.full_name?.trim().split(/\s+/)[0] || "Ping team"]));

  const missing = missingSettings(settings.data);
  const series = open.data ?? [];
  const unclaimed = series.filter((s) => s.status === "unclaimed").length;
  const offering = series.filter((s) => s.status === "offering").length;

  const visits = todays.data ?? [];
  const count = (st: string) => visits.filter((v) => v.status === st).length;
  const doneToday = count("completed");
  const cleaningNow = count("in_progress");
  const toStart = count("scheduled");

  const byKind = new Map<AlertKind, number>();
  for (const a of alerts.data ?? []) {
    const k = alertKind(a.kind);
    if (k) byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }
  const openAlerts = alerts.data?.length ?? 0;
  const urgentAlerts = ALERT_ORDER.filter((k) => ALERT_KIND[k].urgent).reduce((n, k) => n + (byKind.get(k) ?? 0), 0);

  const scoredIds = new Set((scored.data ?? []).map((q) => q.visit_id));
  const toScore = (done.data ?? []).filter((v) => !scoredIds.has(v.id)).length;
  const vetting = (applicants.count ?? 0) + (pendingDocs.count ?? 0);

  return (
    <>
      <PageHeader eyebrow={`Ping admin · ${formatDay(today)}`} title={`Today at Ping, ${firstName(session)}.`} lede="What needs you today, and where every job stands." />

      <NavyPanel className="grid gap-10 px-6 pb-16 pt-8 sm:px-10 sm:pb-20 sm:pt-10 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
        <section aria-labelledby="today-cleans" className="grid content-start gap-6">
          <h2 id="today-cleans" className="text-sm font-semibold uppercase tracking-[0.14em] text-teal">Cleans today</h2>
          <p className="flex items-baseline gap-4">
            <span className="font-display text-4xl font-semibold tabular">{visits.length}</span>
            <span className="text-lg text-on-navy-2">{visits.length === 1 ? "clean booked" : "cleans booked"}</span>
          </p>
          <dl className="grid grid-cols-3 gap-4 border-t border-line-navy pt-6">
            {[
              ["Done", doneToday, "text-ok-on-navy"],
              ["Cleaning now", cleaningNow, "text-teal-glow"],
              ["Still to start", toStart, "text-on-navy"],
            ].map(([label, n, tone]) => (
              <div key={label as string} className="grid gap-1">
                <dt className="text-sm text-on-navy-3">{label}</dt>
                <dd className={`font-display text-2xl font-semibold tabular ${tone}`}>{n}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-labelledby="board" className="grid content-start gap-6 lg:border-l lg:border-line-navy lg:pl-16">
          <h2 id="board" className="text-sm font-semibold uppercase tracking-[0.14em] text-teal">On the board</h2>
          <dl className="grid grid-cols-2 gap-6">
            <div className="grid gap-1">
              <dt className="text-sm text-on-navy-3">Unclaimed jobs</dt>
              <dd className={`font-display text-3xl font-semibold tabular ${unclaimed ? "text-bad-on-navy" : ""}`}>{unclaimed}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-sm text-on-navy-3">On offer now</dt>
              <dd className="font-display text-3xl font-semibold tabular">{offering}</dd>
            </div>
          </dl>
          <p className="text-on-navy-2">{unclaimed ? "Nobody has taken these in time. Assign them by hand." : "Nothing is waiting past its offer windows."}</p>
        </section>
      </NavyPanel>

      <section aria-label="Needs you" className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SectionCard
          href="/admin/jobs#open"
          label="Unclaimed jobs"
          value={unclaimed}
          tone={unclaimed ? "bad" : undefined}
          note={unclaimed ? `${plural(unclaimed, "block")} to assign by hand` : `${plural(offering, "block")} still on offer`}
          cta="Open jobs"
        />
        <SectionCard
          href="/admin/jobs#alerts"
          label="Open alerts"
          value={openAlerts}
          tone={urgentAlerts ? "bad" : openAlerts ? "warn" : undefined}
          note={
            openAlerts ? (
              <span className="flex flex-wrap gap-1.5">
                {ALERT_ORDER.filter((k) => byKind.get(k)).map((k) => (
                  <Badge key={k} tone={ALERT_KIND[k].urgent ? "bad" : "warn"}>
                    {byKind.get(k)} {ALERT_KIND[k].short.toLowerCase()}
                  </Badge>
                ))}
              </span>
            ) : (
              "Nothing for you to sort"
            )
          }
          cta="See alerts"
        />
        <SectionCard
          href="/admin/approvals"
          label="Vetting queue"
          value={vetting}
          tone={vetting ? "warn" : undefined}
          note={`${plural(applicants.count ?? 0, "applicant")} · ${plural(pendingDocs.count ?? 0, "document")} to check`}
          cta="Open approvals"
        />
        <SectionCard
          href="/admin/qc"
          label="Cleans to score"
          value={toScore}
          note={toScore ? "Finished, waiting for a QC score" : "Every finished clean is scored"}
          cta="Open QC"
        />
      </section>

      {missing.length > 0 ? (
        <Card className="mt-10 bg-warn-soft ring-warn/25">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <h2 className="text-xl font-semibold">Booking is switched off until the numbers are set</h2>
              <p className="mt-2 text-navy-2">
                Ping never guesses a price. {missing.length} of {REQUIRED_SETTINGS.length} settings still need deciding.
              </p>
            </div>
            <Badge tone="warn">{missing.length} to set</Badge>
          </div>
          <ul className="mt-6 grid gap-2 sm:grid-cols-2">
            {missing.map((m) => (
              <li key={m.key} className="flex items-center gap-3 text-navy">
                <span className="size-2 rounded-full bg-warn" aria-hidden />
                {m.label}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <section aria-labelledby="activity" className="mt-14">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="activity" className="text-xl font-semibold">Recent changes</h2>
          <p className="text-sm text-navy-3">Every approval, assignment and settings change is logged. No personal details are kept in the log.</p>
        </div>
        {(audit.data ?? []).length === 0 ? (
          <EmptyState title="Nothing logged yet">Every approval, assignment, score and settings change will be recorded here.</EmptyState>
        ) : (
          <Card className="p-0 sm:p-0">
            <ol className="divide-y divide-line">
              {(audit.data ?? []).map((a) => (
                <li key={a.id} className="grid gap-x-6 gap-y-1 px-6 py-4 sm:grid-cols-[9rem_10rem_1fr_auto] sm:items-center">
                  <span className="text-sm tabular text-navy-3">{formatStamp(a.created_at)}</span>
                  <span className="font-semibold">{auditEntity(a.entity)}</span>
                  <span className="text-navy-2">{auditSummary(a.action, a.detail)}</span>
                  {a.actor_id ? (
                    <span className="text-sm text-navy-3">{a.actor_id === session.userId ? "You" : (actorName.get(a.actor_id) ?? "Ping team")}</span>
                  ) : (
                    <Badge className="justify-self-start">{a.actor_label?.startsWith("cron") ? "Engine" : "System"}</Badge>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </section>
    </>
  );
}
