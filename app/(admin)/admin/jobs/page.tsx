import type { Metadata, Route } from "next";
import Link from "next/link";
import { Badge, Card, cn, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { daysAgo, formatDay, formatStamp, formatWindow, todayInLondon, weekdayName, withinLast } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { readAll, ROW_CAP } from "../_lib/read-all";
import { FREQUENCY, TIER, VISIT_STATUS } from "@/lib/labels";
import { formatDuration, formatPence } from "@/lib/money";
import { ALERT_KIND, ALERT_ORDER, alertKind, firstSentence, todoBeyond } from "../_lib/alerts";
import { pgUuid } from "../_lib/ids";
import { BlockActions, ResolveAlert, SettleClean, type CleanerOption, type SettleInfo } from "./block-actions";

export const metadata: Metadata = { title: "Jobs" };

const SERIES_COLS =
  "id, property_id, customer_id, cleaner_id, frequency, preferred_day, window_start, window_end, duration_minutes, block_size, starts_on, ends_on, status, offering_since, first_refusal_cleaner_id, cut_short_cleans, end_reason";

type Slot = { day: number };

const none = () => Promise.resolve({ data: [], error: null });
/** How far back "Marked as not done" looks, and how long a "settled" confirmation is worth showing. */
const NOT_DONE_DAYS = 30;
const JUST_NOW_MS = 10 * 60 * 1000;

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ settled?: string; late?: string }> }) {
  await requireRole("admin", "/admin/jobs");
  const supabase = await createClient();
  const today = todayInLondon();
  // The clean the team has just settled (the settle control sends them back here with it);
  // "late" when someone else on the team had settled it first.
  const query = await searchParams;
  const settledParam = pgUuid.safeParse(query.settled);
  const settledId = settledParam.success ? settledParam.data : null;
  const beatenToIt = query.late === "1";

  const [live, alerts, todays, upcoming, cleaners, notDone, justSettled] = await Promise.all([
    supabase.from("series").select(SERIES_COLS).in("status", ["offering", "unclaimed", "claimed", "paused"]).order("starts_on"),
    supabase.from("engine_alerts").select("id, kind, series_id, visit_id, cleaner_id, message, created_at").is("resolved_at", null).order("created_at", { ascending: false }),
    supabase.from("visits").select("id, series_id, cleaner_id, status, window_start, window_end").eq("scheduled_date", today).order("window_start"),
    // Every booked clean from today, in keyset pages (no 1,000-row cap), then by date.
    readAll((after) => {
      const q = supabase.from("visits").select("id, series_id, scheduled_date").eq("status", "scheduled").gte("scheduled_date", today).order("id").limit(ROW_CAP);
      return after ? q.gt("id", after) : q;
    }, "id").then((r) => ({ ...r, data: r.data?.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)) ?? null })),
    supabase.from("cleaners").select("id, tier, areas, availability").eq("status", "active"),
    // Missed cleans the team said weren't done: kept in reach in case one did happen after all.
    supabase.from("visit_settlements").select("visit_id, reason, created_at")
      .eq("outcome", "not_done").eq("was_status", "no_show")
      .gte("created_at", daysAgo(NOT_DONE_DAYS))
      .order("created_at", { ascending: false }).limit(50),
    settledId
      ? supabase.from("visit_settlements").select("visit_id, outcome, was_status, created_at").eq("visit_id", settledId).order("created_at", { ascending: false }).limit(1)
      : none(),
  ]);
  const failed = live.error || alerts.error || todays.error || upcoming.error || cleaners.error || notDone.error || justSettled.error;

  // The cleans behind "missed" and "never finished" alerts (the team settles those here),
  // the ones already marked as not done, and the one just settled.
  const settleIds = [...new Set((alerts.data ?? []).filter((a) => a.visit_id && isSettleKind(a.kind)).map((a) => a.visit_id!))];
  const cleanIds = [...new Set([...settleIds, ...(notDone.data ?? []).map((n) => n.visit_id), ...(justSettled.data ?? []).map((j) => j.visit_id)])];
  const [cleans, skips] = await Promise.all([
    cleanIds.length
      ? supabase.from("visits").select("id, series_id, customer_id, cleaner_id, scheduled_date, status, price_pence, cleaner_earnings_pence, ping_fee_pence").in("id", cleanIds)
      : none(),
    // Eleven rows a clean at most, and only for cleans waiting to be settled.
    settleIds.length ? supabase.from("checklist_items").select("visit_id, skipped_reason").in("visit_id", settleIds) : none(),
  ]);

  // Blocks that alerts and those cleans point at but that aren't live any more (closed, ended).
  const liveIds = new Set((live.data ?? []).map((s) => s.id));
  const extraIds = [...new Set([...(alerts.data ?? []).map((a) => a.series_id), ...(cleans.data ?? []).map((v) => v.series_id)].filter((id): id is string => !!id && !liveIds.has(id)))];
  const extra = extraIds.length ? await supabase.from("series").select(SERIES_COLS).in("id", extraIds) : { data: [], error: null };
  const series = [...(live.data ?? []), ...(extra.data ?? [])];

  const propIds = [...new Set(series.map((s) => s.property_id))];
  const peopleIds = [...new Set([...series.map((s) => s.customer_id), ...series.map((s) => s.cleaner_id), ...(cleaners.data ?? []).map((c) => c.id), ...(todays.data ?? []).map((v) => v.cleaner_id), ...(alerts.data ?? []).map((a) => a.cleaner_id), ...(cleans.data ?? []).flatMap((v) => [v.customer_id, v.cleaner_id])].filter((id): id is string => !!id))];
  const [props, people] = await Promise.all([
    propIds.length ? supabase.from("properties").select("id, town, postcode_district").in("id", propIds) : Promise.resolve({ data: [], error: null }),
    peopleIds.length ? supabase.from("profiles").select("id, full_name").in("id", peopleIds) : Promise.resolve({ data: [], error: null }),
  ]);

  if (failed || cleans.error || skips.error || extra.error || props.error || people.error) {
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
  const cleanById = new Map((cleans.data ?? []).map((v) => [v.id, v]));
  const skipped = new Map<string, number>();
  for (const row of skips.data ?? []) if (row.skipped_reason) skipped.set(row.visit_id, (skipped.get(row.visit_id) ?? 0) + 1);
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

  // Everything the settle step shows about a clean: who is charged, who is paid, how much.
  type Clean = NonNullable<ReturnType<typeof cleanById.get>>;
  const where = (v: Clean) => { const s = byId.get(v.series_id); return s ? place(s) : "Home"; };
  const settleInfo = (v: Clean): SettleInfo => ({
    visitId: v.id,
    started: v.status === "in_progress",
    summary: `the ${where(v)} clean of ${formatDay(v.scheduled_date)}`,
    customer: name.get(v.customer_id) ?? "The customer",
    cleaner: v.cleaner_id ? name.get(v.cleaner_id) ?? "the cleaner" : null,
    money: v.price_pence > 0
      ? { charge: formatPence(v.price_pence), pay: formatPence(v.cleaner_earnings_pence), fee: formatPence(v.ping_fee_pence) }
      : null,
    couldntDo: skipped.get(v.id) ?? 0,
    onHold: byId.get(v.series_id)?.status === "paused",
  });
  // A missed or unfinished clean from a day that has gone can be settled.
  const canSettle = (v: Clean | undefined): v is Clean => !!v && (v.status === "in_progress" || v.status === "no_show") && v.scheduled_date < today;

  // Missed cleans marked as not done and still missed: the way back if one did happen.
  const openVisits = new Set(openAlerts.filter((a) => isSettleKind(a.kind)).map((a) => a.visit_id));
  const notDoneCleans = (notDone.data ?? [])
    .filter((n, i, all) => all.findIndex((x) => x.visit_id === n.visit_id) === i) // newest per clean
    .map((n) => ({ ...n, clean: cleanById.get(n.visit_id) }))
    .filter((n): n is typeof n & { clean: Clean } => !!n.clean && n.clean.status === "no_show" && !!n.clean.cleaner_id && !openVisits.has(n.visit_id));

  // What the team just did, said by the page: the alert's own card has gone with the alert.
  const last = (justSettled.data ?? [])[0];
  const lastClean = last ? cleanById.get(last.visit_id) : undefined;
  // Sent back "late", the team member is always told why nothing happened, however long ago
  // the colleague settled it: their own card has just vanished from under them.
  const settledNote = last && lastClean && (beatenToIt || withinLast(last.created_at, JUST_NOW_MS))
    ? (beatenToIt ? "Someone on the team had already dealt with this one. " : "") +
      `${where(lastClean)}, ${formatDay(lastClean.scheduled_date)}: marked as ${last.outcome === "done" ? "done" : "not done"}. ` +
      (last.outcome === "done"
        ? lastClean.price_pence > 0
          ? `${name.get(lastClean.customer_id) ?? "The customer"}’s card is charged ${formatPence(lastClean.price_pence)}; ${lastClean.cleaner_id ? name.get(lastClean.cleaner_id) ?? "the cleaner" : "the cleaner"} is paid ${formatPence(lastClean.cleaner_earnings_pence)} after the check period.`
          : "There was nothing to charge."
        : last.was_status === "in_progress"
          ? "The clean is cancelled and nobody is charged."
          : "Nobody is charged. It’s kept under “Marked as not done”, below, in case it did happen.")
    : beatenToIt && settledId
      ? "Nothing was changed: that clean was no longer waiting to be settled. This page shows where it stands now."
      : null;

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
        {settledNote ? (
          // Green when it did what was asked; amber when it didn't, because a colleague had.
          <p role="status" className={cn("rounded-md px-5 py-4 font-semibold ring-1 ring-inset", beatenToIt ? "bg-warn-soft text-warn ring-warn/25" : "bg-ok-soft text-ok ring-ok/25")}>{settledNote}</p>
        ) : null}
        {openAlerts.length === 0 ? (
          <EmptyState title="No open alerts">When something needs a person (a missed clean, a stalled block, cover for today, a cleaner&rsquo;s document running out) it shows here.</EmptyState>
        ) : (
          <ul className="grid gap-4">
            {openAlerts.map((a) => {
              const k = alertKind(a.kind);
              const info = k ? ALERT_KIND[k] : null;
              const s = a.series_id ? byId.get(a.series_id) : undefined;
              const isLive = s && ["offering", "unclaimed", "claimed", "paused"].includes(s.status);
              // A missed or unfinished clean is settled (done, or not done), not just hidden.
              const v = a.visit_id && isSettleKind(a.kind) ? cleanById.get(a.visit_id) : undefined;
              const settle = canSettle(v) ? v : undefined;
              // The engine's words, then what to do, minus any sentence the first already said.
              // For a clean to settle, the engine's own instruction gives way to the two answers.
              const said = settle ? firstSentence(a.message) : a.message;
              const todo = info ? todoBeyond(said, info.todo) : "";
              return (
                <li key={a.id}>
                  <Card className={cn("grid gap-4 sm:grid-cols-[1fr_auto]", info?.urgent && "ring-bad/40")}>
                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <Badge tone={info?.urgent ? "bad" : "warn"}>{info?.label ?? a.kind}</Badge>
                        <span className="text-sm text-navy-3">
                          {formatStamp(a.created_at)}{s ? ` · ${place(s)}` : ""}{a.cleaner_id ? ` · ${name.get(a.cleaner_id) ?? "Cleaner"}` : ""}
                        </span>
                      </div>
                      {settle ? <p className="text-sm font-semibold text-navy-2">{cleanLine(settle, name)}</p> : null}
                      <p className="font-semibold">{said}</p>
                      {todo ? <p className="text-sm text-navy-2">{todo}</p> : null}
                      {isLive ? <a href={`#block-${s.id}`} className="inline-flex min-h-12 items-center text-sm font-semibold text-blue">Go to the block&rsquo;s actions</a> : null}
                      {a.cleaner_id ? (
                        <Link href={`/admin/approvals/${a.cleaner_id}` as Route} className="inline-flex min-h-12 items-center text-sm font-semibold text-blue">
                          Open this cleaner&rsquo;s documents
                        </Link>
                      ) : null}
                    </div>
                    {settle ? <SettleClean info={settleInfo(settle)} /> : <div className="sm:justify-self-end"><ResolveAlert alertId={a.id} /></div>}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        {notDoneCleans.length ? (
          <div className="mt-6 grid gap-3" role="group" aria-labelledby="not-done-title">
            <div className="grid gap-1">
              <h3 id="not-done-title" className="text-lg font-semibold">Marked as not done</h3>
              <p className="max-w-prose text-sm text-navy-2">
                Missed cleans the team said weren&rsquo;t done, from the last {NOT_DONE_DAYS} days. If one turns out to have happened, mark it as done here and it&rsquo;s charged and paid as usual.
              </p>
            </div>
            <ul className="grid gap-3">
              {notDoneCleans.map((n) => (
                <li key={n.visit_id}>
                  <Card className="grid gap-4 sm:grid-cols-[1fr_auto]">
                    <div className="grid gap-1">
                      <p className="font-semibold">{where(n.clean)}, {formatDay(n.clean.scheduled_date)}</p>
                      <p className="text-sm text-navy-2">{cleanLine(n.clean, name)}</p>
                      <p className="text-sm text-navy-2">Marked as not done {formatStamp(n.created_at)}: &ldquo;{n.reason}&rdquo;</p>
                    </div>
                    <SettleClean info={settleInfo(n.clean)} only="done" />
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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

/** The two alerts a person answers by settling the clean: missed, and started but never finished. */
function isSettleKind(kind: string): boolean {
  return kind === "visit_no_show" || kind === "visit_unfinished";
}

/** "Booked for Friday 20 November · Ben Test’s home · with Alex Test": whose clean, at a glance. */
function cleanLine(v: { scheduled_date: string; customer_id: string; cleaner_id: string | null }, name: Map<string, string>): string {
  return `Booked for ${formatDay(v.scheduled_date)} · ${name.get(v.customer_id) ?? "Customer"}’s home · ${v.cleaner_id ? `with ${name.get(v.cleaner_id) ?? "its cleaner"}` : "no cleaner"}`;
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
      {s.status === "unclaimed" ? <Badge tone="bad">Unclaimed</Badge> : s.status === "offering" ? <Badge tone="warn">On offer</Badge> : s.status === "paused" ? <Badge tone="warn">On hold, unpaid</Badge> : <Badge tone="ok">Held</Badge>}
    </div>
  );
}
