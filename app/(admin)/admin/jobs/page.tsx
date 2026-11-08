import type { Metadata } from "next";
import { Badge, Card, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatDay, formatStamp, formatWindow, todayInLondon, weekdayName } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { readAll, ROW_CAP } from "../_lib/read-all";
import { FREQUENCY, TIER, VISIT_STATUS } from "@/lib/labels";
import { formatDuration } from "@/lib/money";
import { ALERT_KIND, ALERT_ORDER, alertKind } from "../_lib/alerts";
import { BlockActions, ResolveAlert, type CleanerOption } from "./block-actions";

export const metadata: Metadata = { title: "Jobs" };

const SERIES_COLS =
  "id, property_id, customer_id, cleaner_id, frequency, preferred_day, window_start, window_end, duration_minutes, block_size, starts_on, ends_on, status, offering_since, first_refusal_cleaner_id, cut_short_cleans, end_reason";

type Slot = { day: number };

export default async function JobsPage() {
  await requireRole("admin", "/admin/jobs");
  const supabase = await createClient();
  const today = todayInLondon();

  const [live, alerts, todays, upcoming, cleaners] = await Promise.all([
    supabase.from("series").select(SERIES_COLS).in("status", ["offering", "unclaimed", "claimed", "paused"]).order("starts_on"),
    supabase.from("engine_alerts").select("id, kind, series_id, visit_id, message, created_at").is("resolved_at", null).order("created_at", { ascending: false }),
    supabase.from("visits").select("id, series_id, cleaner_id, status, window_start, window_end").eq("scheduled_date", today).order("window_start"),
    // Every booked clean from today, in keyset pages (no 1,000-row cap), then by date.
    readAll((after) => {
      const q = supabase.from("visits").select("id, series_id, scheduled_date").eq("status", "scheduled").gte("scheduled_date", today).order("id").limit(ROW_CAP);
      return after ? q.gt("id", after) : q;
    }, "id").then((r) => ({ ...r, data: r.data?.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)) ?? null })),
    supabase.from("cleaners").select("id, tier, areas, availability").eq("status", "active"),
  ]);
  const failed = live.error || alerts.error || todays.error || upcoming.error || cleaners.error;

  // Blocks that alerts point at but that aren't live any more (closed, ended).
  const liveIds = new Set((live.data ?? []).map((s) => s.id));
  const extraIds = [...new Set((alerts.data ?? []).map((a) => a.series_id).filter((id): id is string => !!id && !liveIds.has(id)))];
  const extra = extraIds.length ? await supabase.from("series").select(SERIES_COLS).in("id", extraIds) : { data: [], error: null };
  const series = [...(live.data ?? []), ...(extra.data ?? [])];

  const propIds = [...new Set(series.map((s) => s.property_id))];
  const peopleIds = [...new Set([...series.map((s) => s.customer_id), ...series.map((s) => s.cleaner_id), ...(cleaners.data ?? []).map((c) => c.id), ...(todays.data ?? []).map((v) => v.cleaner_id)].filter((id): id is string => !!id))];
  const [props, people] = await Promise.all([
    propIds.length ? supabase.from("properties").select("id, town, postcode_district").in("id", propIds) : Promise.resolve({ data: [], error: null }),
    peopleIds.length ? supabase.from("profiles").select("id, full_name").in("id", peopleIds) : Promise.resolve({ data: [], error: null }),
  ]);

  if (failed || extra.error || props.error || people.error) {
    return (
      <>
        <PageHeader eyebrow="Jobs" title="Every block, and what needs a hand." />
        <ErrorState title="Jobs didn't load">Refresh the page. Nothing has been changed.</ErrorState>
      </>
    );
  }

  const prop = new Map((props.data ?? []).map((p) => [p.id, p]));
  const name = new Map((people.data ?? []).map((p) => [p.id, p.full_name?.trim() || "No name"]));
  const byId = new Map(series.map((s) => [s.id, s]));
  const next = new Map<string, string>();
  for (const v of upcoming.data ?? []) if (!next.has(v.series_id)) next.set(v.series_id, v.scheduled_date);

  const place = (s: (typeof series)[number]) => {
    const p = prop.get(s.property_id);
    return p ? `${p.town} ${p.postcode_district}` : "Home";
  };
  const rhythm = (s: (typeof series)[number]) =>
    `${FREQUENCY[s.frequency]}, ${weekdayName(s.preferred_day)}s ${formatWindow(s.window_start, s.window_end)} · ${formatDuration(s.duration_minutes)}`;

  const optionsFor = (s: (typeof series)[number]): CleanerOption[] => {
    const district = prop.get(s.property_id)?.postcode_district;
    return (cleaners.data ?? [])
      .map((c) => {
        const slots = Array.isArray(c.availability) ? (c.availability as Slot[]) : [];
        const fits = !!district && c.areas.includes(district) && (slots.length === 0 || slots.some((x) => x.day === s.preferred_day));
        return { id: c.id, fits, tier: c.tier, label: `${name.get(c.id) ?? "Cleaner"} · ${TIER[c.tier]}${fits ? "" : " · outside their areas or days"}` };
      })
      .sort((a, b) => Number(b.fits) - Number(a.fits) || ["top", "approved", "new"].indexOf(a.tier) - ["top", "approved", "new"].indexOf(b.tier))
      .map(({ id, label, fits }) => ({ id, label, fits }));
  };

  const open = series.filter((s) => s.status === "offering" || s.status === "unclaimed").sort((a, b) => (a.status === b.status ? 0 : a.status === "unclaimed" ? -1 : 1));
  const held = series.filter((s) => s.status === "claimed" || s.status === "paused");
  const openAlerts = (alerts.data ?? []).slice().sort((a, b) => {
    const ka = alertKind(a.kind), kb = alertKind(b.kind);
    return Number(kb ? ALERT_KIND[kb].urgent : 0) - Number(ka ? ALERT_KIND[ka].urgent : 0) || ALERT_ORDER.indexOf(ka!) - ALERT_ORDER.indexOf(kb!);
  });

  return (
    <>
      <PageHeader eyebrow="Jobs" title="Every block, and what needs a hand." lede="Today's cleans, blocks still looking for a cleaner, the engine's alerts, and every block that's held." />

      <nav aria-label="On this page" className="mb-10 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
        {[["#today", `Today (${todays.data?.length ?? 0})`], ["#open", `Needs a cleaner (${open.length})`], ["#alerts", `Alerts (${openAlerts.length})`], ["#held", `Held blocks (${held.length})`]].map(([href, label]) => (
          <a key={href} href={href} className="inline-flex min-h-12 items-center text-blue">{label}</a>
        ))}
      </nav>

      <Section id="today" title="Today" count={todays.data?.length ?? 0}>
        {(todays.data ?? []).length === 0 ? (
          <EmptyState title="No cleans today">{formatDay(today)} is clear.</EmptyState>
        ) : (
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-line">
              {(todays.data ?? []).map((v) => {
                const s = byId.get(v.series_id);
                const st = VISIT_STATUS[v.status];
                return (
                  <li key={v.id} className="grid gap-1 px-6 py-4 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-center sm:gap-6">
                    <span className="font-semibold tabular">{formatWindow(v.window_start, v.window_end)}</span>
                    <span>{s ? place(s) : "Home"}</span>
                    <span className="text-navy-2">{v.cleaner_id ? name.get(v.cleaner_id) : "No cleaner"}</span>
                    <Badge tone={st.tone} className="justify-self-start">{st.label}</Badge>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </Section>

      <Section id="open" title="Needs a cleaner" count={open.length}>
        {open.length === 0 ? (
          <EmptyState title="Every block has a cleaner">New bookings appear here while they&rsquo;re being offered, and turn red if nobody claims them in time.</EmptyState>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {open.map((s) => (
              <li key={s.id}>
                <Card className={s.status === "unclaimed" ? "grid gap-5 bg-bad-soft/50 ring-bad/30" : "grid gap-5"} id={`block-${s.id}`}>
                  <BlockHead s={s} place={place(s)} customer={name.get(s.customer_id)} />
                  <p className="text-navy-2">{rhythm(s)}</p>
                  <p className="text-sm text-navy-3">
                    {s.starts_on > today
                      ? `First clean on or after ${formatDay(s.starts_on)}.`
                      : `Was due to start ${formatDay(s.starts_on)}: its cleans move to the next dates once it's taken.`}
                    {s.offering_since ? ` On offer since ${formatStamp(s.offering_since)}.` : ""}
                    {s.first_refusal_cleaner_id ? ` First refusal: ${name.get(s.first_refusal_cleaner_id) ?? "previous cleaner"}.` : ""}
                  </p>
                  <BlockActions seriesId={s.id} held={false} cleaners={optionsFor(s)} summary={`the ${place(s)} block`} />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="alerts" title="Alerts" count={openAlerts.length}>
        {openAlerts.length === 0 ? (
          <EmptyState title="No open alerts">When the engine needs a person (a missed clean, a stalled block, cover for today) it shows here.</EmptyState>
        ) : (
          <ul className="grid gap-4">
            {openAlerts.map((a) => {
              const k = alertKind(a.kind);
              const info = k ? ALERT_KIND[k] : null;
              const s = a.series_id ? byId.get(a.series_id) : undefined;
              const isLive = s && ["offering", "unclaimed", "claimed", "paused"].includes(s.status);
              return (
                <li key={a.id}>
                  <Card className={info?.urgent ? "grid gap-4 ring-bad/40 sm:grid-cols-[1fr_auto]" : "grid gap-4 sm:grid-cols-[1fr_auto]"}>
                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <Badge tone={info?.urgent ? "bad" : "warn"}>{info?.label ?? a.kind}</Badge>
                        <span className="text-sm text-navy-3">{formatStamp(a.created_at)}{s ? ` · ${place(s)}` : ""}</span>
                      </div>
                      <p className="font-semibold">{a.message}</p>
                      {info ? <p className="text-sm text-navy-2">{info.todo}</p> : null}
                      {isLive ? <a href={`#block-${s.id}`} className="inline-flex min-h-12 items-center text-sm font-semibold text-blue">Go to the block&rsquo;s actions</a> : null}
                    </div>
                    <div className="sm:justify-self-end"><ResolveAlert alertId={a.id} /></div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section id="held" title="Held blocks" count={held.length}>
        {held.length === 0 ? (
          <EmptyState title="No blocks held yet">Once a cleaner claims a block, it&rsquo;s listed here until its last clean.</EmptyState>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {held.map((s) => (
              <li key={s.id}>
                <Card className="grid gap-5" id={`block-${s.id}`}>
                  <BlockHead s={s} place={place(s)} customer={name.get(s.customer_id)} cleaner={s.cleaner_id ? name.get(s.cleaner_id) : undefined} />
                  <p className="text-navy-2">{rhythm(s)}</p>
                  <p className="text-sm text-navy-3">
                    {next.get(s.id) ? `Next clean ${formatDay(next.get(s.id)!)}.` : "No clean booked from today."} Last clean {formatDay(s.ends_on)}.
                    {s.cut_short_cleans ? ` ${s.cut_short_cleans} cut short by the next block.` : ""}
                  </p>
                  <BlockActions seriesId={s.id} held cleaners={[]} summary={`the ${place(s)} block`} />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function Section({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mb-14 grid scroll-mt-28 gap-4">
      <div className="flex items-baseline gap-3">
        <h2 id={`${id}-title`} className="text-xl font-semibold">{title}</h2>
        <span className="font-display text-xl font-semibold text-navy-3 tabular">{count}</span>
      </div>
      {children}
    </section>
  );
}

function BlockHead({ s, place, customer, cleaner }: { s: { status: string; block_size: number }; place: string; customer?: string; cleaner?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="grid gap-1">
        <h3 className="text-xl font-semibold">{place}</h3>
        <p className="text-sm text-navy-3">
          {customer ?? "Customer"} · {s.block_size} {s.block_size === 1 ? "clean" : "cleans"}
          {cleaner ? ` · with ${cleaner}` : ""}
        </p>
      </div>
      {s.status === "unclaimed" ? <Badge tone="bad">Unclaimed</Badge> : s.status === "offering" ? <Badge tone="warn">On offer</Badge> : s.status === "paused" ? <Badge>Paused</Badge> : <Badge tone="ok">Held</Badge>}
    </div>
  );
}
