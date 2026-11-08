import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, ErrorState } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { requireRole } from "@/lib/auth/session";
import { formatDay, formatTime, relativeDay, todayInLondon } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import type { Enums } from "@/lib/db/types";
import { VISIT_STATUS } from "@/lib/labels";
import { liveBlockPositions, dayOfMonth, isYmd, minutesOf, shortWeekday, step, viewDays, viewTitle, type View } from "../../_lib/calendar";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

type Clean = {
  id: string;
  date: string;
  start: string;
  end: string;
  minutes: number;
  status: Enums<"visit_status">;
  /** Town only while they hold the block (RLS returns the home only then). */
  town: string | null;
  n: number;
  of: number;
};

const FIRST_HOUR = 7;
const LAST_HOUR = 20;
const HOUR_PX = 56;

/**
 * The cleaner's own cleans across all their blocks, like a phone calendar: a month or a
 * week, with an agenda list on phones. Each clean shows its time, town and place in its
 * block ("3 of 8"), and opens the clean itself, where the full address is (held work only).
 * No street addresses here at all: town is enough to plan a week.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const session = await requireRole("cleaner", "/work/calendar");
  const sp = await searchParams;
  const view: View = sp.view === "week" ? "week" : "month";
  const today = todayInLondon();
  const anchor = isYmd(sp.date) ? sp.date : today;
  const days = viewDays(view, anchor);
  const from = days[0]!;
  const to = days.at(-1)!;

  const supabase = await createClient();
  const { data: me } = await supabase.from("cleaners").select("status").eq("id", session.userId).maybeSingle();

  const head = <CalendarHead view={view} anchor={anchor} today={today} />;
  if (me?.status !== "active") {
    return (
      <>
        {head}
        <EmptyState title="Your calendar fills up once you're approved">
          Every clean you claim shows here, across all your blocks.
        </EmptyState>
      </>
    );
  }

  const visits = await supabase
    .from("visits")
    .select("id, series_id, scheduled_date, window_start, window_end, duration_minutes, status")
    .eq("cleaner_id", session.userId)
    .gte("scheduled_date", from)
    .lte("scheduled_date", to)
    .neq("status", "cancelled") // a block that ended cancels its cleans; they aren't work
    .order("scheduled_date")
    .order("window_start");
  const seriesIds = [...new Set((visits.data ?? []).map((v) => v.series_id))];
  const [series, siblings] = seriesIds.length
    ? await Promise.all([
        supabase.from("series").select("id, property_id, block_size").in("id", seriesIds).eq("cleaner_id", session.userId),
        supabase.from("visits").select("id, series_id, scheduled_date, status").in("series_id", seriesIds).eq("cleaner_id", session.userId),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const propertyIds = [...new Set((series.data ?? []).map((s) => s.property_id))];
  const homes = propertyIds.length
    ? await supabase.from("properties").select("id, town").in("id", propertyIds)
    : { data: [], error: null };

  if (visits.error || series.error || siblings.error || homes.error) {
    return (
      <>
        {head}
        <ErrorState>Your calendar didn&rsquo;t load. Check your signal and refresh.</ErrorState>
      </>
    );
  }

  const seriesById = new Map((series.data ?? []).map((s) => [s.id, s]));
  const townById = new Map((homes.data ?? []).map((h) => [h.id, h.town]));
  const block = liveBlockPositions(siblings.data ?? [], (id) => seriesById.get(id)?.block_size ?? 0);
  const cleans: Clean[] = (visits.data ?? []).map((v) => {
    const s = seriesById.get(v.series_id);
    return {
      id: v.id,
      date: v.scheduled_date,
      start: v.window_start,
      end: v.window_end,
      minutes: v.duration_minutes,
      status: v.status,
      town: s ? (townById.get(s.property_id) ?? null) : null,
      n: block.n(v.id),
      of: block.of(v.series_id),
    };
  });
  const byDay = new Map<string, Clean[]>();
  for (const c of cleans) byDay.set(c.date, [...(byDay.get(c.date) ?? []), c]);

  return (
    <>
      {head}
      {/* Phones: a small month (or week) strip, then the list. */}
      <div className="grid gap-8 md:hidden">
        <MiniGrid view={view} days={days} anchor={anchor} today={today} byDay={byDay} />
        <Agenda view={view} days={days} byDay={byDay} today={today} />
      </div>
      {/* Larger screens: the full grid. */}
      <div className="hidden md:block">
        {view === "month" ? (
          <MonthGrid days={days} anchor={anchor} today={today} byDay={byDay} />
        ) : (
          <WeekGrid days={days} today={today} byDay={byDay} />
        )}
      </div>
    </>
  );
}

function href(view: View, date: string) {
  return `/work/calendar?view=${view}&date=${date}` as const;
}

function CalendarHead({ view, anchor, today }: { view: View; anchor: string; today: string }) {
  const tab = (v: View, label: string) => (
    <Link
      href={href(v, anchor)}
      aria-current={view === v ? "page" : undefined}
      className={cn("inline-flex min-h-12 flex-1 items-center justify-center rounded-full px-5 font-semibold sm:flex-none", view === v ? "bg-navy text-on-navy" : "text-navy-2 hover:bg-mist")}
    >
      {label}
    </Link>
  );
  const arrow = (dir: -1 | 1) => (
    <Link
      href={href(view, step(view, anchor, dir))}
      aria-label={dir < 0 ? `Previous ${view}` : `Next ${view}`}
      className="grid size-12 place-items-center rounded-full bg-card ring-1 ring-inset ring-line hover:ring-navy-3"
    >
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
        <path d={dir < 0 ? "m15 5-7 7 7 7" : "m9 5 7 7-7 7"} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
  return (
    <header className="grid gap-5 pb-8">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-teal-ink">Your calendar</p>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{viewTitle(view, anchor)}</h1>
        <div className="flex items-center gap-2">
          {arrow(-1)}
          <Link href={href(view, today)} className="inline-flex min-h-12 items-center rounded-full bg-card px-5 font-semibold ring-1 ring-inset ring-line hover:ring-navy-3">
            Today
          </Link>
          {arrow(1)}
        </div>
      </div>
      <nav aria-label="Calendar view" className="flex gap-1 rounded-full bg-mist p-1 sm:w-fit">
        {tab("week", "Week")}
        {tab("month", "Month")}
      </nav>
    </header>
  );
}

const TONE: Record<Enums<"visit_status">, string> = {
  scheduled: "bg-mist text-navy ring-navy/10",
  in_progress: "bg-teal-soft text-teal-ink ring-teal/30",
  completed: "bg-ok-soft text-ok ring-ok/20",
  skipped: "bg-mist text-navy-3 ring-line line-through",
  cancelled: "bg-mist text-navy-3 ring-line line-through",
  no_show: "bg-bad-soft text-bad ring-bad/20",
};

function label(c: Clean) {
  const where = c.town ?? "A finished block";
  return `${formatTime(c.start)}, ${where}, clean ${c.n} of ${c.of}, ${VISIT_STATUS[c.status].label}`;
}

function Chip({ c }: { c: Clean }) {
  return (
    <Link href={`/work/visit/${c.id}`} aria-label={label(c)} className={cn("block min-h-11 rounded-sm px-2 py-1.5 text-xs leading-tight ring-1 ring-inset transition-shadow hover:shadow-card", TONE[c.status])}>
      <span className="block font-semibold tabular">{formatTime(c.start)} · {c.n} of {c.of}</span>
      <span className="block truncate">{c.town ?? "Finished block"}</span>
    </Link>
  );
}

function MonthGrid({ days, anchor, today, byDay }: { days: string[]; anchor: string; today: string; byDay: Map<string, Clean[]> }) {
  const month = anchor.slice(0, 7);
  return (
    <div className="overflow-hidden rounded-lg bg-card shadow-card ring-1 ring-line/70">
      <div className="grid grid-cols-7 border-b border-line/70 bg-mist/50">
        {days.slice(0, 7).map((d) => (
          <div key={d} className="px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-navy-3">{shortWeekday(d)}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const out = d.slice(0, 7) !== month;
          return (
            <div key={d} className={cn("grid min-h-32 content-start gap-1.5 border-b border-r border-line/60 p-2 [&:nth-child(7n)]:border-r-0", out && "bg-mist/40")}>
              <span
                className={cn(
                  "grid size-7 place-items-center rounded-full text-sm font-semibold tabular",
                  d === today ? "bg-teal text-navy" : out ? "text-navy-3/70" : "text-navy-2",
                )}
                aria-label={formatDay(d)}
              >
                {dayOfMonth(d)}
              </span>
              {list.map((c) => <Chip key={c.id} c={c} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({ days, today, byDay }: { days: string[]; today: string; byDay: Map<string, Clean[]> }) {
  const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);
  const height = hours.length * HOUR_PX;
  return (
    <div className="overflow-hidden rounded-lg bg-card shadow-card ring-1 ring-line/70">
      <div className="grid grid-cols-[4rem_repeat(7,minmax(0,1fr))] border-b border-line/70 bg-mist/50">
        <div />
        {days.map((d) => (
          <div key={d} className="grid justify-items-start gap-0.5 px-3 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-navy-3">{shortWeekday(d)}</span>
            <span className={cn("grid size-8 place-items-center rounded-full font-display text-lg font-semibold tabular", d === today && "bg-teal text-navy")}>{dayOfMonth(d)}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[4rem_repeat(7,minmax(0,1fr))]">
        <div className="relative" style={{ height }}>
          {hours.map((h, i) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-xs text-navy-3 tabular" style={{ top: i * HOUR_PX }}>
              {i === 0 ? "" : formatTime(`${String(h).padStart(2, "0")}:00`)}
            </span>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} className={cn("relative border-l border-line/60", d === today && "bg-teal-soft/30")} style={{ height }}>
            {hours.map((h, i) => (
              <div key={h} className="absolute inset-x-0 border-t border-line/50" style={{ top: i * HOUR_PX }} aria-hidden />
            ))}
            {(byDay.get(d) ?? []).map((c) => {
              const startMin = Math.max(minutesOf(c.start), FIRST_HOUR * 60);
              const top = ((startMin - FIRST_HOUR * 60) / 60) * HOUR_PX;
              const h = Math.max((c.minutes / 60) * HOUR_PX, 44);
              return (
                <Link
                  key={c.id}
                  href={`/work/visit/${c.id}`}
                  aria-label={label(c)}
                  className={cn("absolute inset-x-1 grid content-start gap-0.5 overflow-hidden rounded-md px-2.5 py-2 text-xs ring-1 ring-inset transition-shadow hover:shadow-card", TONE[c.status])}
                  style={{ top, height: Math.min(h, height - top) }}
                >
                  <span className="font-semibold tabular">{formatTime(c.start)}–{formatTime(c.end)}</span>
                  <span className="truncate font-semibold">{c.town ?? "Finished block"}</span>
                  <span className="tabular">Clean {c.n} of {c.of}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <p className="border-t border-line/70 px-4 py-3 text-sm text-navy-3">
        Each clean is drawn from the start of its arrival window, as long as the clean takes. You can arrive any time in the window.
      </p>
    </div>
  );
}

function MiniGrid({ view, days, anchor, today, byDay }: { view: View; days: string[]; anchor: string; today: string; byDay: Map<string, Clean[]> }) {
  const month = anchor.slice(0, 7);
  return (
    <div className="rounded-lg bg-card p-3 shadow-card ring-1 ring-line/70">
      <div className="grid grid-cols-7 text-center">
        {days.slice(0, 7).map((d) => (
          <span key={d} className="py-1 text-xs font-semibold text-navy-3">{shortWeekday(d).slice(0, 1)}</span>
        ))}
        {days.map((d) => {
          const n = (byDay.get(d) ?? []).length;
          const out = view === "month" && d.slice(0, 7) !== month;
          return (
            <a
              key={d}
              href={n ? `#day-${d}` : undefined}
              aria-label={`${formatDay(d)}${n ? `, ${n} clean${n === 1 ? "" : "s"}` : ""}`}
              className="grid min-h-12 place-items-center content-center gap-1"
            >
              <span className={cn("grid size-8 place-items-center rounded-full text-sm font-semibold tabular", d === today ? "bg-teal text-navy" : out ? "text-navy-3/60" : "text-navy")}>
                {dayOfMonth(d)}
              </span>
              <span className={cn("size-1.5 rounded-full", n ? "bg-navy" : "bg-transparent")} aria-hidden />
            </a>
          );
        })}
      </div>
    </div>
  );
}

function Agenda({ view, days, byDay, today }: { view: View; days: string[]; byDay: Map<string, Clean[]>; today: string }) {
  // A week lists every day (so a free day reads as free); a month lists only days with cleans.
  const shown = view === "week" ? days : days.filter((d) => byDay.has(d));
  if (!shown.length) {
    return <EmptyState title="Nothing booked this month">Claim a job and its cleans appear here, every one of them.</EmptyState>;
  }
  return (
    <ol className="grid gap-6">
      {shown.map((d) => {
        const list = byDay.get(d) ?? [];
        return (
          <li key={d} id={`day-${d}`} className="grid scroll-mt-24 gap-2.5">
            <h2 className={cn("text-sm font-semibold uppercase tracking-[0.14em]", d === today ? "text-teal-ink" : "text-navy-3")}>{relativeDay(d)}</h2>
            {list.length === 0 ? (
              <p className="rounded-md bg-mist/60 px-4 py-3 text-navy-3">Nothing booked</p>
            ) : (
              <ul className="grid gap-2.5">
                {list.map((c) => (
                  <li key={c.id}>
                    <Link href={`/work/visit/${c.id}`} className={cn("flex min-h-16 items-center gap-4 rounded-md px-4 py-3 ring-1 ring-inset", TONE[c.status])}>
                      <span className="w-16 shrink-0 font-display text-lg font-semibold tabular">{formatTime(c.start)}</span>
                      <span className="grid flex-1 gap-0.5">
                        <span className="font-semibold">{c.town ?? "Finished block"}</span>
                        <span className="text-sm opacity-80">Clean {c.n} of {c.of} · {VISIT_STATUS[c.status].label}</span>
                      </span>
                      <svg viewBox="0 0 24 24" className="size-5 shrink-0 opacity-60" aria-hidden>
                        <path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
