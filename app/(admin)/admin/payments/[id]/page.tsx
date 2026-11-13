import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatDay, formatStamp } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { formatPence } from "@/lib/money";
import { pgUuid } from "../../_lib/ids";
import { canRefund, PAYMENT_STATUS, PAYOUT_STATUS, REASON_LABEL, REFUND_STATUS } from "../_lib/payments";
import { RefundForm } from "./refund-form";

export const metadata: Metadata = { title: "Payment" };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin", "/admin/payments");
  const id = pgUuid.safeParse((await params).id);
  if (!id.success) notFound();
  const supabase = await createClient();

  const pay = await supabase.from("payments")
    .select("id, visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, refunded_pence, status, kind, last_error_code, created_at")
    .eq("id", id.data).in("kind", ["visit", "late_cancel"]).maybeSingle();
  if (pay.error) return <ErrorState>This payment didn&rsquo;t load. Refresh to try again.</ErrorState>;
  const p = pay.data;
  if (!p) notFound();

  const [visit, refunds, payouts] = await Promise.all([
    supabase.from("visits").select("scheduled_date, cleaner_id, couldnt_do_count").eq("id", p.visit_id).maybeSingle(),
    supabase.from("refunds").select("id, amount_pence, cleaner_part_pence, ping_part_pence, reason, status, created_at").eq("payment_id", p.id).order("created_at", { ascending: false }),
    supabase.from("payouts").select("amount_pence, status, held_reason, available_after, paid_at").eq("payment_id", p.id).order("created_at", { ascending: false }).limit(1),
  ]);
  const v = visit.data;
  const peopleIds = [p.customer_id, v?.cleaner_id].filter((x): x is string => !!x);
  const people = await supabase.from("profiles").select("id, full_name").in("id", peopleIds);
  const nameById = new Map((people.data ?? []).map((x) => [x.id, x.full_name]));

  const now = new Date();
  const status = PAYMENT_STATUS[p.status] ?? { label: p.status, tone: "neutral" as const };
  const payout = payouts.data?.[0] ?? null;
  const onItsWay = (refunds.data ?? []).some((r) => r.status === "pending");
  const left = p.amount_pence - p.refunded_pence;
  const isFee = p.kind === "late_cancel";
  const cleanerName = v?.cleaner_id ? (nameById.get(v.cleaner_id) ?? "The cleaner") : "The cleaner";

  return (
    <>
      <p className="mb-4">
        <Link href="/admin/payments" className="inline-flex min-h-12 items-center font-semibold text-navy underline decoration-line decoration-2 underline-offset-4 hover:decoration-navy">All payments</Link>
      </p>
      <PageHeader eyebrow={v ? `${isFee ? "Late cancellation fee, clean" : "Clean"} on ${formatDay(v.scheduled_date, now)}` : "Payment"} title={`${nameById.get(p.customer_id) ?? "A customer"}: ${formatPence(p.amount_pence)}.`}
        action={<Badge tone={status.tone} className="px-4 py-2 text-sm">{status.label}</Badge>} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-8">
        <div className="grid gap-6">
          <Card className="grid gap-5">
            <h2 className="text-xl font-semibold">How it was split.</h2>
            <dl className="grid gap-4">
              <div className="flex items-baseline justify-between gap-4"><dt className="text-navy-2">The customer paid</dt><dd className="font-display text-xl font-semibold tabular">{formatPence(p.amount_pence)}</dd></div>
              <div className="flex items-baseline justify-between gap-4"><dt className="text-navy-2">{cleanerName}&rsquo;s {isFee ? "part" : "earnings"}</dt><dd className="font-display text-xl font-semibold tabular">{formatPence(p.cleaner_amount_pence)}</dd></div>
              <div className="flex items-baseline justify-between gap-4"><dt className="text-navy-2">Ping&rsquo;s {isFee ? "part" : "fee"}</dt><dd className="font-display text-xl font-semibold tabular">{formatPence(p.application_fee_pence)}</dd></div>
              <div className="flex items-baseline justify-between gap-4 border-t border-line pt-4"><dt className="font-semibold">Refunded so far</dt><dd className="font-display text-xl font-semibold tabular" data-refunded>{formatPence(p.refunded_pence)}</dd></div>
            </dl>
          </Card>

          <Card className="grid gap-3">
            <h2 className="text-xl font-semibold">{cleanerName}&rsquo;s {isFee ? "part of this fee" : "pay for this clean"}.</h2>
            {payout ? (
              <>
                <p className="font-display text-2xl font-semibold tabular" data-payout-amount>{formatPence(payout.amount_pence)}</p>
                <p className="text-navy-2" data-payout-status={payout.status}>
                  {PAYOUT_STATUS[payout.status] ?? payout.status}
                  {payout.status === "held" && payout.held_reason === "refund_pending" ? " while a refund goes through" : ""}
                  {payout.status === "held" && payout.held_reason === "dispute_open" ? " until the chargeback is settled" : ""}
                  {payout.status === "pending" ? `, after ${formatStamp(payout.available_after)}` : ""}
                  {payout.status === "paid" && payout.paid_at ? ` on ${formatStamp(payout.paid_at)}` : ""}.
                </p>
              </>
            ) : (
              <p className="text-navy-2">Nothing yet. Their earnings appear once the customer&rsquo;s payment has gone through.</p>
            )}
          </Card>
        </div>

        <div className="grid gap-6">
          <Card className="grid gap-6">
            <div className="grid gap-2">
              <h2 className="text-xl font-semibold">{isFee ? "Refunding this fee." : "Refund this clean."}</h2>
              {isFee ? null : canRefund(p.status) && !onItsWay ? <p className="text-navy-2">{formatPence(left)} is left to refund. The reason decides who carries it.</p> : null}
            </div>
            {isFee ? (
              <p className="rounded-md bg-mist px-5 py-4 text-navy-2" data-fee-no-refund>A late-cancellation fee can&rsquo;t be refunded from here yet. Don&rsquo;t refund it in Stripe either: Ping wouldn&rsquo;t record it, and the cleaner would still be paid their part.</p>
            ) : onItsWay ? (
              <p role="status" className="rounded-md bg-warn-soft px-5 py-4 font-medium">A refund for this clean is on its way. Another can be made once it&rsquo;s finished.</p>
            ) : canRefund(p.status) && left > 0 ? (
              <RefundForm payment={{ id: p.id, amount_pence: p.amount_pence, application_fee_pence: p.application_fee_pence, refunded_pence: p.refunded_pence }}
                cleanerPaid={payout?.status === "in_batch" || payout?.status === "paid"} />
            ) : (
              <p className="rounded-md bg-mist px-5 py-4 text-navy-2">
                {p.status === "refunded" ? "This clean has been refunded in full."
                  : p.status === "disputed" ? "The customer's bank has disputed this payment. It can't be refunded while that's open: answer the chargeback in Stripe."
                  : p.status === "dispute_lost" ? "This payment was lost to a chargeback. The customer's bank has already taken it back."
                  : "Only a clean the customer has paid for can be refunded."}
              </p>
            )}
          </Card>

          {(refunds.data ?? []).length > 0 ? (
            <Card className="grid gap-5">
              <h2 className="text-xl font-semibold">Refunds on this clean.</h2>
              <ol className="grid gap-4">
                {(refunds.data ?? []).map((r) => {
                  const s = REFUND_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
                  return (
                    <li key={r.id} data-refund-status={r.status} className="grid gap-2 border-t border-line pt-4 first:border-0 first:pt-0">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="font-display text-xl font-semibold tabular">{formatPence(r.amount_pence)}</span>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </div>
                      <p className="text-navy-2">
                        {REASON_LABEL[r.reason] ?? r.reason}, {formatStamp(r.created_at)}.{" "}
                        {r.cleaner_part_pence > 0 ? `${formatPence(r.cleaner_part_pence)} from the cleaner, ${formatPence(r.ping_part_pence)} from Ping.` : "Ping carried all of it."}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
