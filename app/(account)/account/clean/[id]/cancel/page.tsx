import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, ErrorState } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatDay, formatStamp, formatWindow } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { formatDuration, formatPence } from "@/lib/money";
import { CancelButton } from "./cancel-button";

export const metadata: Metadata = { title: "Cancel a clean" };

export default async function CancelCleanPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("customer", "/account");
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const supabase = await createClient();

  // Row level security: only the customer's own clean comes back.
  const { data: v, error } = await supabase.from("visits")
    .select("id, scheduled_date, window_start, window_end, duration_minutes, status, price_pence").eq("id", id).maybeSingle();
  if (error) return <ErrorState>We couldn&rsquo;t load that clean just now. Refresh the page.</ErrorState>;
  if (!v) notFound();
  const quoted = await supabase.rpc("cancel_visit_quote", { p_visit: v.id });
  const q = quoted.data?.[0];
  if (quoted.error || !q) return <ErrorState>We couldn&rsquo;t work out what cancelling would cost just now. Refresh the page.</ErrorState>;

  const when = `${formatDay(v.scheduled_date)}, ${formatWindow(v.window_start, v.window_end)}`;
  const summary = (
    <aside className="relative overflow-hidden rounded-xl signal-waves p-8 text-on-navy sm:p-10 lg:col-span-5">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-teal">The clean</p>
      <p className="mt-6 text-balance font-display text-2xl font-semibold leading-tight">{formatDay(v.scheduled_date)}</p>
      <p className="mt-3 text-lg text-on-navy-2">{formatWindow(v.window_start, v.window_end)} · {formatDuration(v.duration_minutes)}</p>
      <p className="mt-8 border-t border-line-navy pt-5 text-on-navy-2">{formatPence(v.price_pence)} when it&rsquo;s done. Nothing has been charged for it.</p>
    </aside>
  );
  const back = (
    <Link href="/account" className="inline-flex min-h-12 items-center font-semibold text-navy underline decoration-line decoration-2 underline-offset-4 hover:decoration-navy">
      Keep this clean
    </Link>
  );

  if (!q.can_cancel) {
    return (
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
        {summary}
        <Card className="grid content-start gap-6 p-8 sm:p-12 lg:col-span-7">
          <Badge className="justify-self-start">Can&rsquo;t be cancelled here</Badge>
          <h1 className="text-balance text-2xl font-semibold sm:text-3xl">This clean can&rsquo;t be cancelled now.</h1>
          <p className="max-w-prose text-lg text-navy-2">
            {v.status === "cancelled" ? "It’s already cancelled." : v.status === "completed" ? "It’s already been done." : "Its time has started, or your cleaner is already there. If something’s wrong, call the Ping office."}
          </p>
          <ButtonLink href="/account" size="lg" variant="ink" className="justify-self-start">Back to My cleans</ButtonLink>
        </Card>
      </div>
    );
  }

  const free = q.fee_pence === 0;
  return (
    <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
      {summary}
      <Card className="grid content-start gap-7 p-8 sm:p-12 lg:col-span-7" data-cancel-quote={q.fee_pence}>
        <Badge tone={free ? "ok" : "warn"} className="justify-self-start">{free ? "Free to cancel" : "Short notice"}</Badge>
        <div className="grid gap-4">
          <h1 className="text-balance text-2xl font-semibold sm:text-3xl">
            {free ? "Cancel this clean?" : <>Cancelling now costs <span className="tabular">{formatPence(q.fee_pence)}</span>.</>}
          </h1>
          <p className="max-w-prose text-lg text-navy-2">
            {free && !q.late ? <>Your clean on {when} will be cancelled and nothing is charged. It stays free to cancel until <strong className="text-navy">{formatStamp(q.free_until)}</strong>.</>
              : free ? <>Your clean on {when} will be cancelled. It&rsquo;s short notice, but there&rsquo;s nothing to pay.</>
              : <>Your clean on {when} is close enough that your cleaner can&rsquo;t fill the time, so there&rsquo;s a late-cancellation fee. It goes on your saved card, and your cleaner is paid from it.</>}
          </p>
          <p className="max-w-prose text-navy-2">The rest of your cleans carry on as booked. A cancelled clean isn&rsquo;t moved to another day.</p>
        </div>
        <CancelButton visitId={v.id} feePence={q.fee_pence} label={free ? "Cancel this clean" : `Cancel and pay ${formatPence(q.fee_pence)}`} />
        {back}
      </Card>
    </div>
  );
}
