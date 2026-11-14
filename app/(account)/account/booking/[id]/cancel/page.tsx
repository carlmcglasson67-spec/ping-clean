import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, ErrorState } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatDay, formatWindow, weekdayName } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { FREQUENCY } from "@/lib/labels";
import { formatPence } from "@/lib/money";
import { CancelBlockButton } from "./cancel-block-button";

export const metadata: Metadata = { title: "Cancel the rest of your cleans", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleans = (n: number) => `${n} ${n === 1 ? "clean" : "cleans"}`;

export default async function CancelBlockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole("customer", `/account/booking/${id}/cancel`);
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  // Row level security: only the customer's own block and cleans come back.
  const [{ data: s, error }, upcoming] = await Promise.all([
    supabase.from("series").select("id, frequency, preferred_day, window_start, window_end, status, block_size").eq("id", id).maybeSingle(),
    supabase.from("visits").select("id, scheduled_date, window_start, window_end, status").eq("series_id", id).in("status", ["scheduled", "in_progress"]).order("scheduled_date"),
  ]);
  if (error || upcoming.error) return <ErrorState>We couldn&rsquo;t load your booking just now. Refresh the page.</ErrorState>;
  if (!s) notFound();
  const quoted = await supabase.rpc("cancel_block_quote", { p_series: s.id });
  const q = quoted.data?.[0];
  if (quoted.error || !q) return <ErrorState>We couldn&rsquo;t work out what cancelling would cost just now. Refresh the page.</ErrorState>;

  const bookingHref = `/account/booking/${s.id}` as Route;
  const list = upcoming.data ?? [];
  const summary = (
    <aside className="relative overflow-hidden rounded-xl signal-waves p-8 text-on-navy sm:p-10 lg:col-span-5">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-teal">Your block</p>
      <p className="mt-6 text-balance font-display text-2xl font-semibold leading-tight">
        {cleans(s.block_size)}, {weekdayName(s.preferred_day)}s
      </p>
      <p className="mt-3 text-lg text-on-navy-2">{FREQUENCY[s.frequency]} · {formatWindow(s.window_start, s.window_end)}</p>
      {list.length ? (
        <div className="mt-8 border-t border-line-navy pt-6">
          <p className="text-base text-on-navy-3">Still to come</p>
          <ol className="mt-3 grid gap-2 text-lg">
            {list.map((v) => (
              <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="font-semibold">{formatDay(v.scheduled_date)}</span>
                <span className="text-base text-on-navy-2">{v.status === "in_progress" ? "Under way" : formatWindow(v.window_start, v.window_end)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="mt-8 border-t border-line-navy pt-6 text-on-navy-2">No cleans are booked in yet.</p>
      )}
    </aside>
  );
  const keep = (
    <Link href={bookingHref} className="inline-flex min-h-12 items-center font-semibold text-navy underline decoration-line decoration-2 underline-offset-4 hover:decoration-navy">
      Keep my cleans
    </Link>
  );

  if (!q.can_cancel) {
    const ended = s.status === "ended";
    return (
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
        {summary}
        <Card className="grid content-start gap-6 p-8 sm:p-12 lg:col-span-7">
          <Badge className="justify-self-start">{ended ? "Already ended" : "Not just now"}</Badge>
          <h1 className="text-balance text-2xl font-semibold sm:text-3xl">
            {ended ? "This block has already ended." : "One of your cleans is under way or about to start."}
          </h1>
          <p className="max-w-prose text-lg text-navy-2">
            {ended
              ? "There’s nothing left to cancel."
              : "You can cancel the rest as soon as it’s finished. To cancel a single later clean now, use Cancel this clean in My cleans. If something’s wrong today, call the Ping office."}
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
            {free ? "Cancel the rest of your cleans?" : <>Cancelling now costs <span className="tabular">{formatPence(q.fee_pence)}</span>.</>}
          </h1>
          <p className="max-w-prose text-lg text-navy-2">
            {q.cleans === 0 ? (
              <>Your block ends and no more cleans are booked for it. There&rsquo;s nothing to pay.</>
            ) : free && q.late === 0 ? (
              <>All {cleans(q.cleans)} still to come will be cancelled and your block ends. Nothing is charged.</>
            ) : free ? (
              <>All {cleans(q.cleans)} still to come will be cancelled and your block ends. {q.late === 1 ? "One is" : `${q.late} are`} at short notice, but there&rsquo;s nothing to pay.</>
            ) : (
              <>All {cleans(q.cleans)} still to come will be cancelled and your block ends. {q.late === 1 ? "One is" : `${q.late} are`} close enough that your cleaner can&rsquo;t fill the time, so there&rsquo;s a late-cancellation fee. It goes on your saved card, and your cleaner is paid from it.</>
            )}
          </p>
          <p className="max-w-prose text-navy-2">Cleans already done stay as they are. This can&rsquo;t be undone: to start again, you&rsquo;d make a new booking.</p>
        </div>
        <CancelBlockButton seriesId={s.id} feePence={q.fee_pence} label={free ? "Cancel the rest of my cleans" : `Cancel them and pay ${formatPence(q.fee_pence)}`} />
        {keep}
      </Card>
    </div>
  );
}
