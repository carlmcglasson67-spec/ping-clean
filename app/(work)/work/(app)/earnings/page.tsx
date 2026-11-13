import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, ErrorState, NavyPanel, PageHeader } from "@/components/ui";
import { buttonClass } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/session";
import { formatDay, monthStartInLondon, todayInLondon } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { formatPence } from "@/lib/money";
import { EARNING_COPY, earningNote, earningStep, earningTotals, sinceDay, type EarningRow } from "../../_lib/earnings";

export const metadata: Metadata = { title: "Your earnings" };

const SINCE_DAYS = 90;

export default async function EarningsPage() {
  const session = await requireRole("cleaner", "/work/earnings");
  const supabase = await createClient();
  const since = sinceDay(SINCE_DAYS);

  // RLS gives a cleaner only their own cleans, earnings and bank payouts. Amounts and states
  // only: no Stripe ids are readable, and nothing about the customer's payment.
  const [visits, payouts, batches] = await Promise.all([
    supabase.from("visits").select("id, scheduled_date, cleaner_earnings_pence")
      .eq("cleaner_id", session.userId).eq("status", "completed").gte("scheduled_date", since)
      .order("scheduled_date", { ascending: false }).limit(200),
    supabase.from("payouts").select("visit_id, batch_id, amount_pence, status, available_after, paid_at")
      .eq("cleaner_id", session.userId).order("created_at", { ascending: false }).limit(400),
    supabase.from("payout_batches").select("id, status, arrival_date").eq("cleaner_id", session.userId)
      .order("created_at", { ascending: false }).limit(200),
  ]);

  const header = <PageHeader eyebrow="Getting paid" title="Your earnings." />;
  if (visits.error || payouts.error || batches.error) {
    return (
      <>
        {header}
        <ErrorState>Your earnings didn&rsquo;t load. Check your signal and refresh.</ErrorState>
      </>
    );
  }

  const batchById = new Map((batches.data ?? []).map((b) => [b.id, b]));
  // One live payout row per clean; a failed or cancelled one never hides a live one.
  const payoutByVisit = new Map<string, NonNullable<typeof payouts.data>[number]>();
  for (const p of payouts.data ?? []) {
    const have = payoutByVisit.get(p.visit_id);
    if (!have || have.status === "cancelled") payoutByVisit.set(p.visit_id, p);
  }
  const rows: EarningRow[] = (visits.data ?? []).filter((v) => v.cleaner_earnings_pence > 0).map((v) => {
    const p = payoutByVisit.get(v.id) ?? null;
    return {
      visitId: v.id,
      cleanDate: v.scheduled_date,
      amountPence: p?.amount_pence ?? v.cleaner_earnings_pence,
      payout: p ? { status: p.status, available_after: p.available_after, paid_at: p.paid_at } : null,
      batch: p?.batch_id ? (batchById.get(p.batch_id) ?? null) : null,
    };
  });

  if (rows.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          title="Nothing earned yet"
          action={<Link href="/work/jobs" className={buttonClass("primary", "lg")}>See new jobs</Link>}
        >
          Each clean you finish shows here, with where its money is on the way to your bank.
        </EmptyState>
      </>
    );
  }

  const now = new Date();
  const totals = earningTotals(rows, monthStartInLondon(now), now);
  const day = (ymd: string) => (ymd === todayInLondon(now) ? "today" : formatDay(ymd, now));

  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-8">
        <div className="grid gap-4 lg:sticky lg:top-6">
          <NavyPanel className="grid gap-8 p-7 pb-24 sm:p-10 sm:pb-28">
            <div className="grid gap-2">
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-teal">On its way to you</p>
              <p className="font-display text-5xl font-semibold leading-none text-white tabular sm:text-6xl" data-total="on-its-way">{formatPence(totals.onItsWay)}</p>
              <p className="max-w-sm text-on-navy/85">Paid cleans in their check period, or already with your bank.</p>
            </div>
            <dl className="grid grid-cols-2 gap-6 border-t border-white/15 pt-6">
              <div className="grid gap-1">
                <dt className="text-sm text-on-navy/75">Paid this month</dt>
                <dd className="font-display text-2xl font-semibold text-white tabular" data-total="paid">{formatPence(totals.paidThisMonth)}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-sm text-on-navy/75">Being processed</dt>
                <dd className="font-display text-2xl font-semibold text-white tabular" data-total="awaiting">{formatPence(totals.awaitingPayment)}</dd>
              </div>
            </dl>
          </NavyPanel>

          {totals.refused > 0 ? (
            <section aria-label="Your bank details need checking" className="grid gap-4 rounded-lg bg-bad-soft p-6 ring-1 ring-bad/20 sm:p-7">
              <p className="text-lg font-semibold text-bad">Your bank didn&rsquo;t accept {formatPence(totals.refused)}.</p>
              <p className="text-navy-2">It&rsquo;s safe in your Stripe account. Check your bank details and it&rsquo;s sent again within a day.</p>
              <Link href="/work/payments" className={buttonClass("ink", "lg", "w-full sm:w-auto sm:justify-self-start")}>Check my bank details</Link>
            </section>
          ) : null}
        </div>

        <section aria-labelledby="by-clean" className="grid gap-4">
          <h2 id="by-clean" className="text-xl font-semibold">Clean by clean.</h2>
          <ol className="grid gap-3">
            {rows.map((r) => {
              const step = earningStep(r, now);
              const copy = EARNING_COPY[step];
              return (
                <li key={r.visitId} data-earning-step={step}>
                  <Card className="grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6 sm:p-6">
                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="text-lg font-semibold">{formatDay(r.cleanDate, now)}</span>
                        <Badge tone={copy.tone}>{copy.label}</Badge>
                      </div>
                      <p className="text-navy-2">{earningNote(r, step, day)}</p>
                    </div>
                    <p className={`font-display text-2xl font-semibold tabular ${step === "cancelled" ? "text-navy-3 line-through" : ""}`}>{formatPence(r.amountPence)}</p>
                  </Card>
                </li>
              );
            })}
          </ol>
          <p className="text-sm text-navy-2">Showing cleans from the last {SINCE_DAYS} days.</p>
        </section>
      </div>
    </>
  );
}
