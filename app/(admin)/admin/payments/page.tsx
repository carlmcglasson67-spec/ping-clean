import type { Metadata, Route } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatDay } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { formatPence } from "@/lib/money";
import { PAYMENT_STATUS } from "./_lib/payments";

export const metadata: Metadata = { title: "Payments" };

const SHOWN = 100;
const NEEDS_YOU = new Set(["disputed", "failed_final", "requires_action"]);

export default async function PaymentsPage() {
  await requireRole("admin", "/admin/payments");
  const supabase = await createClient();
  const pay = await supabase.from("payments")
    .select("id, visit_id, customer_id, amount_pence, refunded_pence, status, kind, created_at")
    .in("kind", ["visit", "late_cancel"]).order("created_at", { ascending: false }).limit(SHOWN);

  const header = (
    <PageHeader eyebrow="Payments" title="Every clean's money."
      lede="What each customer paid for each clean, and any late-cancellation fee, and where it stands. Open a clean to refund all or part of it." />
  );
  if (pay.error) return (<>{header}<ErrorState>The payments didn&rsquo;t load. Refresh to try again.</ErrorState></>);
  const rows = pay.data ?? [];
  if (rows.length === 0) {
    return (<>{header}<EmptyState title="No payments yet">A clean shows here once it&rsquo;s finished and the customer&rsquo;s card has been charged.</EmptyState></>);
  }

  const visitIds = [...new Set(rows.map((r) => r.visit_id))];
  const visits = await supabase.from("visits").select("id, scheduled_date, cleaner_id").in("id", visitIds);
  if (visits.error) return (<>{header}<ErrorState>The payments didn&rsquo;t load. Refresh to try again.</ErrorState></>);
  const visitById = new Map((visits.data ?? []).map((v) => [v.id, v]));
  const peopleIds = [...new Set([...rows.map((r) => r.customer_id), ...(visits.data ?? []).map((v) => v.cleaner_id).filter((x): x is string => !!x)])];
  const people = await supabase.from("profiles").select("id, full_name").in("id", peopleIds);
  const nameById = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));

  const now = new Date();
  const needsYou = rows.filter((r) => NEEDS_YOU.has(r.status));
  const taken = rows.filter((r) => ["succeeded", "partially_refunded", "refunded"].includes(r.status));
  const totals = {
    paid: taken.reduce((n, r) => n + r.amount_pence, 0),
    refunded: taken.reduce((n, r) => n + r.refunded_pence, 0),
  };

  return (
    <>
      {header}
      <div className="grid gap-8">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Card className="grid gap-2">
            <dt className="text-sm font-semibold text-navy">Taken (last {rows.length} cleans)</dt>
            <dd className="font-display text-3xl font-semibold tabular">{formatPence(totals.paid)}</dd>
          </Card>
          <Card className="grid gap-2">
            <dt className="text-sm font-semibold text-navy">Refunded</dt>
            <dd className="font-display text-3xl font-semibold tabular">{formatPence(totals.refunded)}</dd>
          </Card>
          <Card className={`grid gap-2 ${needsYou.length ? "bg-bad-soft ring-1 ring-bad/30" : ""}`}>
            <dt className="text-sm font-semibold text-navy">Need someone</dt>
            <dd className="font-display text-3xl font-semibold tabular">{needsYou.length}</dd>
            <dd className="text-sm text-navy-2">Unpaid, waiting on the customer, or disputed.</dd>
          </Card>
        </dl>

        <section aria-labelledby="all-payments" className="grid gap-4">
          <h2 id="all-payments" className="text-xl font-semibold">Most recent first.</h2>
          <ol className="grid gap-3">
            {rows.map((r) => {
              const v = visitById.get(r.visit_id);
              const status = PAYMENT_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
              return (
                <li key={r.id}>
                  <Link href={`/admin/payments/${r.id}` as Route} data-payment={r.id} data-kind={r.kind}
                    className="group grid gap-3 rounded-lg bg-card p-5 shadow-card ring-1 ring-line/70 transition-[box-shadow,transform] duration-200 ease-out-soft hover:-translate-y-0.5 hover:shadow-lift sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6 sm:p-6">
                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="text-lg font-semibold">{nameById.get(r.customer_id) ?? "A customer"}</span>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <p className="text-navy-2">
                        {r.kind === "late_cancel" ? "Late cancellation fee for the clean" : "Clean"}{v ? ` on ${formatDay(v.scheduled_date, now)}` : ""}
                        {v?.cleaner_id ? `${r.kind === "late_cancel" ? ", kept by" : " by"} ${nameById.get(v.cleaner_id) ?? "a cleaner"}` : ""}
                        {r.refunded_pence > 0 ? `. ${formatPence(r.refunded_pence)} refunded` : ""}.
                      </p>
                    </div>
                    <p className="font-display text-2xl font-semibold tabular">{formatPence(r.amount_pence)}</p>
                  </Link>
                </li>
              );
            })}
          </ol>
          {rows.length === SHOWN ? <p className="text-sm text-navy-2">Showing the latest {SHOWN}.</p> : null}
        </section>
      </div>
    </>
  );
}
