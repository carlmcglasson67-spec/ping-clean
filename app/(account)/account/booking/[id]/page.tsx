import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, ErrorState } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatDay, formatWindow, weekdayName } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { FREQUENCY, SERIES_STATUS } from "@/lib/labels";
import { formatDuration, formatPence, formatPenceShort } from "@/lib/money";
import { blockTotalPence, firstCleanDate } from "../../../../(site)/_lib/checkout";
import { quotePence } from "../../../../(site)/_lib/quote";

export const metadata: Metadata = { title: "Your booking", robots: { index: false } };

const NEXT_STEPS = [
  { title: "We find your cleaner", body: "Your cleans go first to our highest-rated cleaners near you, then to every vetted cleaner who covers your area." },
  { title: "You see who’s coming", body: "As soon as a cleaner takes on your block, their name and your dates appear in My cleans." },
  // A-4: becomes "Card saved" once Stripe card saving is switched on.
  { title: "Your card, before the first clean", body: "We’ll ask you to save a card before your first clean. Nothing is charged until a clean is finished." },
  { title: "Pay after each clean", body: "One clean at a time, only once it’s done, with photos and the checklist to show for it." },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole("customer", `/account/booking/${id}`);
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  // RLS: a customer can only read their own series; anyone else's id is simply not found.
  const { data: s, error } = await supabase
    .from("series")
    .select("id, property_id, frequency, preferred_day, window_start, window_end, duration_minutes, price_per_hour_pence, status, starts_on, ends_on, block_size")
    .eq("id", id)
    .maybeSingle();
  if (error) return <ErrorState>We couldn&rsquo;t load your booking just now. Refresh the page to try again.</ErrorState>;
  if (!s) notFound();
  const { data: home } = await supabase.from("properties").select("address_line1, town, postcode").eq("id", s.property_id).maybeSingle();

  const status = SERIES_STATUS[s.status];
  const perClean = quotePence(s.price_per_hour_pence, s.duration_minutes);
  const total = blockTotalPence(s.price_per_hour_pence, s.duration_minutes, s.block_size);
  const first = firstCleanDate(s.starts_on, s.preferred_day);
  const waiting = s.status === "offering" || s.status === "unclaimed";

  return (
    <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
      <section aria-labelledby="booked-title" className="lg:col-span-7">
        <div className="relative overflow-hidden rounded-xl signal-waves p-8 text-on-navy sm:p-12">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal">{waiting ? "Booked" : "Your block"}</p>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <h1 id="booked-title" className="mt-8 text-3xl font-semibold">
            {s.block_size} {s.block_size === 1 ? "clean" : "cleans"}, {weekdayName(s.preferred_day)}s.
          </h1>
          <p className="mt-4 text-xl text-on-navy-2">
            {FREQUENCY[s.frequency]} · {formatWindow(s.window_start, s.window_end)} · {formatDuration(s.duration_minutes)}
          </p>
          <dl className="mt-10 grid grid-cols-2 gap-6 border-t border-line-navy pt-8">
            <div>
              <dt className="text-base text-on-navy-3">Each clean</dt>
              <dd className="mt-1 font-display text-[clamp(2rem,1.6rem+1.5vw,3rem)] font-semibold leading-none tabular">{formatPenceShort(perClean)}</dd>
            </div>
            <div>
              <dt className="text-base text-on-navy-3">All {s.block_size}</dt>
              <dd className="mt-1 font-display text-[clamp(2rem,1.6rem+1.5vw,3rem)] font-semibold leading-none tabular">{formatPence(total)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-base text-on-navy-3">{s.block_size === 1 ? "Date" : "Dates"}</dt>
              <dd className="mt-1 text-lg font-semibold">{s.block_size === 1 ? formatDay(first) : `${formatDay(first)} to ${formatDay(s.ends_on)}`}</dd>
            </div>
          </dl>
          {home ? (
            <p className="mt-8 border-t border-line-navy pt-6 text-lg text-on-navy-2">
              {home.address_line1}, {home.town} {home.postcode}
            </p>
          ) : null}
          {waiting ? (
            <p className="mt-6 text-base text-on-navy-3">If a cleaner takes your block on after the first date, your dates move later rather than you losing a clean.</p>
          ) : null}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/account" size="lg" variant="ink">
            Go to My cleans
          </ButtonLink>
        </div>
      </section>

      <section aria-labelledby="next-title" className="lg:col-span-5">
        <Card className="p-8 sm:p-10">
          <h2 id="next-title" className="text-2xl font-semibold">
            What happens next
          </h2>
          <ol className="mt-6 grid">
            {NEXT_STEPS.map((n, i) => (
              <li key={n.title} className="grid grid-cols-[3rem_1fr] gap-x-3 border-t border-line py-6 first:border-t-0 first:pt-0">
                <span className="font-display text-2xl font-semibold text-teal-ink tabular" aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-lg font-semibold">{n.title}</h3>
                  <p className="mt-1 text-base text-navy-2">{n.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </div>
  );
}
