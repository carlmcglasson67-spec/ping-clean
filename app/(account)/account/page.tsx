import { Badge, Card, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { firstName, requireRole } from "@/lib/auth/session";
import { formatWindow, relativeDay, todayInLondon, weekdayName } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { FREQUENCY, SERIES_STATUS, VISIT_STATUS } from "@/lib/labels";
import { formatDuration, formatPence } from "@/lib/money";

/** "today", "tomorrow" or "on Monday 9 November", to sit inside a sentence. */
function whenPhrase(ymd: string) {
  const when = relativeDay(ymd);
  return when === "Today" || when === "Tomorrow" ? when.toLowerCase() : `on ${when}`;
}

export default async function AccountHome() {
  const session = await requireRole("customer", "/account");
  const supabase = await createClient();
  const today = todayInLondon();

  // Row level security limits every query below to this customer's own rows.
  const [series, visits, properties, payments] = await Promise.all([
    supabase
      .from("series")
      .select("id, property_id, frequency, preferred_day, window_start, window_end, duration_minutes, status, starts_on")
      .neq("status", "ended")
      .order("created_at"),
    supabase
      .from("visits")
      .select("id, series_id, scheduled_date, window_start, window_end, duration_minutes, status, price_pence")
      .gte("scheduled_date", today)
      .in("status", ["scheduled", "in_progress"])
      .order("scheduled_date")
      .limit(6),
    supabase.from("properties").select("id, address_line1, town, postcode"),
    supabase.from("payments").select("id").eq("status", "succeeded"),
  ]);

  const failed = series.error || visits.error || properties.error || payments.error;
  const propertyById = new Map((properties.data ?? []).map((p) => [p.id, p]));
  const active = series.data ?? [];
  const upcoming = visits.data ?? [];
  const next = upcoming[0];

  return (
    <>
      <PageHeader
        eyebrow="My cleans"
        title={`Hello, ${firstName(session)}.`}
        lede={next ? <>Your next clean is <strong className="text-ink">{whenPhrase(next.scheduled_date)}</strong>, {formatWindow(next.window_start, next.window_end)}.</> : "Everything to do with your regular clean, in one place."}
      />

      {failed ? (
        <ErrorState>We couldn&rsquo;t load your cleans just now. Refresh the page, and if it keeps happening, call the Ping office.</ErrorState>
      ) : active.length === 0 ? (
        <EmptyState title="No regular clean booked yet">
          Once you book, your cleaner, your next visit and every receipt will show here. Online booking opens soon. Until then, call the Ping office to get started.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-8">
          <section aria-labelledby="regular" className="grid gap-6">
            <h2 id="regular" className="sr-only">Your regular clean</h2>
            {active.map((s) => {
              const home = propertyById.get(s.property_id);
              const status = SERIES_STATUS[s.status];
              return (
                <Card key={s.id} className="grain relative overflow-hidden bg-ink text-paper ring-0">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <p className="text-sm font-semibold uppercase tracking-[0.14em] text-signal">Your regular clean</p>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <p className="mt-6 font-display text-3xl font-semibold">
                    {weekdayName(s.preferred_day)}s
                  </p>
                  <p className="mt-2 text-lg text-paper/75">
                    {FREQUENCY[s.frequency]} · {formatWindow(s.window_start, s.window_end)} · {formatDuration(s.duration_minutes)}
                  </p>
                  {home ? (
                    <p className="mt-8 border-t border-line-dark pt-5 text-paper/70">
                      {home.address_line1}, {home.town} {home.postcode}
                    </p>
                  ) : null}
                </Card>
              );
            })}
            <Card className="flex items-center justify-between gap-6">
              <div>
                <p className="font-display text-2xl font-semibold tabular">{payments.data?.length ?? 0}</p>
                <p className="text-sm text-ink-2">Paid cleans with receipts</p>
              </div>
              <p className="max-w-[14rem] text-right text-sm text-ink-3">You&rsquo;re only charged after each clean is finished.</p>
            </Card>
          </section>

          <section aria-labelledby="upcoming">
            <h2 id="upcoming" className="mb-4 text-xl font-semibold">Coming up</h2>
            {upcoming.length === 0 ? (
              <EmptyState title="Nothing booked in yet">
                Your visits appear here as soon as your cleaner is confirmed.
              </EmptyState>
            ) : (
              <ol className="grid gap-3">
                {upcoming.map((v) => {
                  const st = VISIT_STATUS[v.status];
                  return (
                    <li key={v.id}>
                      <Card className="flex items-center gap-5 p-5 sm:p-6">
                        <div className="grid flex-1 gap-1">
                          <p className="text-lg font-semibold">{relativeDay(v.scheduled_date)}</p>
                          <p className="text-sm text-ink-2">
                            {formatWindow(v.window_start, v.window_end)} · {formatDuration(v.duration_minutes)}
                          </p>
                        </div>
                        <div className="grid justify-items-end gap-2">
                          <Badge tone={st.tone}>{st.label}</Badge>
                          <span className="text-sm font-semibold tabular text-ink-2">{formatPence(v.price_pence)}</span>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      )}
    </>
  );
}
