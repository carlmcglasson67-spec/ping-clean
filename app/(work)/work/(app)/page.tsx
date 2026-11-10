import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, EmptyState, ErrorState, PageHeader, PingMark, Stat } from "@/components/ui";
import { firstName, requireRole } from "@/lib/auth/session";
import { formatWindow, monthStartInLondon, relativeDay, todayInLondon } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { TIER, VISIT_STATUS } from "@/lib/labels";
import { formatDuration, formatPence, formatPenceShort } from "@/lib/money";
import type { Enums } from "@/lib/db/types";
import { cleansToDo, todayHeadline } from "../_lib/today";
import { Application } from "./application";

export default async function WorkHome() {
  const session = await requireRole("cleaner", "/work");
  const supabase = await createClient();
  const { data: me, error } = await supabase
    .from("cleaners")
    .select("status, tier, areas, rating_avg, completed_visits")
    .eq("id", session.userId)
    .maybeSingle();

  if (error) {
    return <ErrorState>We couldn&rsquo;t load your account just now. Check your signal and refresh.</ErrorState>;
  }
  if (!me || me.status === "applicant") {
    return <Application name={firstName(session)} cleanerId={session.userId} />;
  }
  if (me.status !== "active") {
    return (
      <>
        <PageHeader eyebrow="Your account" title="Your account is on hold." />
        <EmptyState title="Jobs are paused for now">
          You won&rsquo;t see or receive new jobs while your account is on hold. Call the Ping office to talk it through.
        </EmptyState>
      </>
    );
  }

  const today = todayInLondon();
  const [todays, upcoming, offers, payouts] = await Promise.all([
    supabase
      .from("visits")
      .select("id, scheduled_date, window_start, window_end, duration_minutes, status, cleaner_earnings_pence")
      .eq("scheduled_date", today)
      .neq("status", "cancelled") // a block that ended cancels its cleans, it doesn't delete them
      .order("window_start"),
    supabase
      .from("visits")
      .select("id, scheduled_date, window_start, window_end, duration_minutes, status, cleaner_earnings_pence")
      .gt("scheduled_date", today)
      .eq("status", "scheduled")
      .order("scheduled_date")
      .limit(5),
    // The same list the job board shows, so the count never promises a job that's gone.
    supabase.rpc("job_board"),
    supabase.from("payouts").select("amount_pence, status, paid_at").gte("created_at", monthStartInLondon()),
  ]);
  const failed = todays.error || upcoming.error || offers.error || payouts.error;
  const paidThisMonth = (payouts.data ?? []).filter((p) => p.status === "paid").reduce((sum, p) => sum + p.amount_pence, 0);
  const comingToYou = (payouts.data ?? []).filter((p) => p.status === "pending").reduce((sum, p) => sum + p.amount_pence, 0);
  const jobs = cleansToDo(todays.data ?? []);

  return (
    <>
      <PageHeader
        eyebrow={`${TIER[me.tier]} cleaner`}
        title={`Hi ${firstName(session)}. ${todayHeadline(jobs.length)}`}
        lede={
          <>
            You cover {me.areas.length ? me.areas.join(", ") : "no areas yet"}.{" "}
            <Link href="/work/areas" className="inline-flex min-h-12 items-center font-semibold text-navy underline decoration-line decoration-2 underline-offset-4 hover:decoration-navy">
              {me.areas.length ? "Change" : "Choose your areas"}
            </Link>
          </>
        }
      />

      {failed ? (
        <ErrorState>Some of your jobs didn&rsquo;t load. Check your signal and refresh.</ErrorState>
      ) : (
        // Phone order: today's work, new jobs (first to claim wins), coming up, money.
        // Desktop: work on the left, jobs and money on the right.
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-x-10">
          <section aria-labelledby="today" className="grid content-start gap-4 lg:col-start-1 lg:row-start-1">
            <h2 id="today" className="text-xl font-semibold">Today</h2>
            {jobs.length === 0 ? (
              <EmptyState title="A free day">
                New jobs in your areas will show up here once you claim them.
              </EmptyState>
            ) : (
              <>
                <ol className="grid gap-3">
                  {jobs.map((v) => <VisitRow key={v.id} v={v} />)}
                </ol>
                <Link href="/work/today" className={buttonClass("ink", "lg", "w-full sm:w-auto sm:justify-self-start")}>
                  Addresses and directions
                </Link>
              </>
            )}
          </section>

          <Card className="grain relative overflow-hidden bg-teal text-navy ring-0 lg:col-start-2 lg:row-start-1 lg:self-start">
            <div className="flex items-center gap-3">
              <PingMark pulse dot="ink" className="text-navy" />
              <p className="text-sm font-bold uppercase tracking-[0.14em]">New jobs for you</p>
            </div>
            <p className="mt-5 font-display text-4xl font-semibold tabular">{offers.data?.length ?? 0}</p>
            <p className="mt-2 max-w-xs text-navy/80">
              {offers.data?.length ? "Waiting in your areas now. First to claim gets the job." : "We'll ping you the moment one comes up in your areas."}
            </p>
            <Link href="/work/jobs" className={buttonClass("ink", "lg", "mt-6 w-full sm:w-auto")}>
              {offers.data?.length ? "See the jobs" : "Open the job board"}
            </Link>
          </Card>

          <section aria-labelledby="coming" className="grid content-start gap-4 lg:col-start-1 lg:row-start-2">
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="coming" className="text-xl font-semibold">Coming up</h2>
              <Link href="/work/calendar" className="inline-flex min-h-12 items-center font-semibold text-navy underline decoration-line decoration-2 underline-offset-4 hover:decoration-navy">
                Your calendar
              </Link>
            </div>
            {(upcoming.data ?? []).length === 0 ? (
              <EmptyState title="Nothing else booked yet" />
            ) : (
              <ol className="grid gap-3">
                {(upcoming.data ?? []).map((v) => <VisitRow key={v.id} v={v} showDay />)}
              </ol>
            )}
          </section>

          <aside aria-label="Your earnings and record" className="grid content-start gap-4 lg:col-start-2 lg:row-start-2">
            <Card className="grid grid-cols-2 gap-6">
              <Stat value={formatPenceShort(paidThisMonth)} label="Paid this month" />
              <Stat value={formatPenceShort(comingToYou)} label="On its way" note="Paid after the check period" />
            </Card>
            <Card className="grid grid-cols-2 gap-6">
              <Stat value={me.completed_visits} label="Cleans done" />
              <Stat value={me.rating_avg != null ? Number(me.rating_avg).toFixed(1) : "–"} label="Customer rating" note={me.rating_avg != null ? "out of 5" : "After your first reviews"} />
            </Card>
          </aside>
        </div>
      )}
    </>
  );
}

type VisitLite = {
  id: string;
  scheduled_date: string;
  window_start: string;
  window_end: string;
  duration_minutes: number;
  status: Enums<"visit_status">;
  cleaner_earnings_pence: number;
};

function VisitRow({ v, showDay = false }: { v: VisitLite; showDay?: boolean }) {
  const st = VISIT_STATUS[v.status];
  return (
    <li>
      <Card className="flex items-center gap-5 p-5 sm:p-6">
        <div className="grid flex-1 gap-1">
          <p className="text-lg font-semibold">{showDay ? relativeDay(v.scheduled_date) : formatWindow(v.window_start, v.window_end)}</p>
          <p className="text-sm text-navy-2">
            {showDay ? `${formatWindow(v.window_start, v.window_end)} · ` : ""}
            {formatDuration(v.duration_minutes)}
          </p>
        </div>
        <div className="grid justify-items-end gap-2">
          <Badge tone={st.tone}>{st.label}</Badge>
          <span className="text-sm font-semibold tabular text-navy-2">You earn {formatPence(v.cleaner_earnings_pence)}</span>
        </div>
      </Card>
    </li>
  );
}

