import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, ErrorState } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatDay } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { formatPence } from "@/lib/money";
import { PayPanel } from "./pay-panel";

export const metadata: Metadata = { title: "Sort a payment", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAID = ["succeeded", "partially_refunded", "refunded", "disputed", "dispute_lost"];

/** What happened, in the customer's words. */
function story(status: string, onHold: boolean) {
  if (status === "requires_action") {
    return { badge: "Needs you", tone: "warn" as const, title: "Your bank wants you to confirm this payment.", body: "It’s a quick check that it’s really you. Nothing is taken until you’ve done it." };
  }
  if (onHold) {
    return { badge: "Cleans on hold", tone: "bad" as const, title: "Your cleans are on hold until this is paid.", body: "Your bank declined the payment each time we tried, so your cleaner won’t come for now. Pay it and your remaining cleans are straight back on." };
  }
  return { badge: "Payment failed", tone: "bad" as const, title: "We couldn’t take this payment.", body: "Your bank declined it. You can pay now with the same card, or use a different one." };
}

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole("customer", `/account/pay/${id}`);
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  // RLS: a customer reads only their own payments; anyone else's id is simply not found.
  const { data: p, error } = await supabase.from("payments").select("id, visit_id, amount_pence, status, kind").eq("id", id).maybeSingle();
  if (error) return <ErrorState>We couldn&rsquo;t load this payment just now. Refresh the page to try again.</ErrorState>;
  if (!p) notFound();
  const isFee = p.kind === "late_cancel";

  const [{ data: v }, { data: cards }] = await Promise.all([
    supabase.from("visits").select("scheduled_date, series_id").eq("id", p.visit_id).maybeSingle(),
    supabase.rpc("my_saved_card"),
  ]);
  const { data: s } = v ? await supabase.from("series").select("status").eq("id", v.series_id).maybeSingle() : { data: null };
  const card = cards?.[0]?.brand && cards[0].last4 ? { brand: cards[0].brand, last4: cards[0].last4 } : null;
  const amount = formatPence(p.amount_pence);
  const clean = v ? `${isFee ? "Late cancellation of your clean" : "Clean"} on ${formatDay(v.scheduled_date)}` : isFee ? "A late cancellation" : "Your clean";

  const summary = (
    <div className="relative overflow-hidden rounded-xl signal-waves p-8 text-on-navy sm:p-12 lg:col-span-5 lg:self-start">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal">{clean}</p>
      <p className="mt-8 font-display text-[clamp(3rem,2.2rem+3.4vw,5rem)] font-semibold leading-none tabular">{amount}</p>
      <p className="mt-5 text-lg text-on-navy-2">{isFee ? "The fee for cancelling at short notice. Most of it goes to the cleaner who had kept the time for you." : "One clean, charged after it was finished. Your cleaner is paid from this."}</p>
    </div>
  );

  if (PAID.includes(p.status)) {
    return (
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
        {summary}
        <section aria-labelledby="pay-title" className="grid content-start gap-6 rounded-xl bg-ok-soft p-8 ring-1 ring-ok/25 sm:p-12 lg:col-span-7">
          <h1 id="pay-title" className="text-3xl font-semibold text-ok">Paid. Thank you.</h1>
          <p className="max-w-prose text-lg text-navy-2">
            {s?.status === "paused" ? "That’s this one sorted. Another clean in this block is still unpaid, so your cleans stay on hold until that’s paid too." : "Nothing more to do. Your cleans carry on as booked."}
          </p>
          <ButtonLink href="/account" size="lg" variant="ink" className="justify-self-start">Go to My cleans</ButtonLink>
        </section>
      </div>
    );
  }

  if (p.status === "pending" || p.status === "processing") {
    return (
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
        {summary}
        <Card className="grid content-start gap-6 p-8 sm:p-12 lg:col-span-7">
          <Badge className="justify-self-start">In progress</Badge>
          <h1 className="text-3xl font-semibold">This payment is being taken.</h1>
          <p className="max-w-prose text-lg text-navy-2">It usually takes less than a minute. There&rsquo;s nothing you need to do: refresh this page to see how it went.</p>
          <ButtonLink href={`/account/pay/${p.id}` as Route} size="lg" variant="secondary" className="justify-self-start" prefetch={false}>Refresh</ButtonLink>
        </Card>
      </div>
    );
  }

  const say = story(p.status, s?.status === "paused");
  return (
    <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
      {summary}
      <Card className="grid content-start gap-8 p-8 sm:p-12 lg:col-span-7">
        <div className="grid gap-4">
          <Badge tone={say.tone} className="justify-self-start">{say.badge}</Badge>
          <h1 className="text-3xl font-semibold">{say.title}</h1>
          <p className="max-w-prose text-lg text-navy-2">{say.body}</p>
        </div>
        <PayPanel paymentId={p.id} amount={amount} card={card} needsBank={p.status === "requires_action"} />
      </Card>
    </div>
  );
}
