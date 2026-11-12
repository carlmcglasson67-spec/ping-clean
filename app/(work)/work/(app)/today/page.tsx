import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { requireRole } from "@/lib/auth/session";
import { formatDay, formatWindow, todayInLondon } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import type { Enums, Tables } from "@/lib/db/types";
import { VISIT_STATUS } from "@/lib/labels";
import { formatDuration, formatPence } from "@/lib/money";
import { directionsUrl } from "../../_lib/directions";
import { StartButton } from "../visit/[id]/start-button";
import { KeyCode } from "./key-code";

export const metadata: Metadata = { title: "Today" };

// Always rendered fresh for this cleaner, never cached: it carries addresses and key
// codes, which must disappear the moment a job stops being theirs. (proxy.ts also marks
// every /work response private, no-store.)
export const dynamic = "force-dynamic";

type Property = Pick<
  Tables<"properties">,
  "id" | "address_line1" | "address_line2" | "town" | "postcode" | "latitude" | "longitude" | "bedrooms" | "bathrooms" | "pets" | "access_notes" | "key_code"
>;

/** Visits a cleaner is on their way to, or at. Only these show access notes and the key code. */
const LIVE: Enums<"visit_status">[] = ["scheduled", "in_progress"];

export default async function TodayPage() {
  const session = await requireRole("cleaner", "/work/today");
  const supabase = await createClient();
  const today = todayInLondon();

  const header = (n: number) => (
    <PageHeader
      eyebrow={formatDay(today)}
      title={n === 0 ? "Nothing booked today." : n === 1 ? "One clean today." : `${n} cleans today.`}
      lede={n ? "Addresses, access notes and key codes for today's cleans. They're only here on the day." : undefined}
    />
  );

  const { data: me } = await supabase.from("cleaners").select("status").eq("id", session.userId).maybeSingle();
  if (me?.status !== "active") {
    return (
      <>
        {header(0)}
        <EmptyState title="Your cleans will show here">
          Once you&rsquo;re approved and claim a job, each day&rsquo;s jobs appear here with the address and directions.
        </EmptyState>
      </>
    );
  }

  // Three plain reads, each through RLS: my visits today → their series (mine) → the
  // properties, which RLS only returns while I hold the series and am an active cleaner.
  const visits = await supabase
    .from("visits")
    .select("id, series_id, window_start, window_end, duration_minutes, status, cleaner_earnings_pence")
    .eq("cleaner_id", session.userId)
    .eq("scheduled_date", today)
    .neq("status", "cancelled") // same as the home screen: a cancelled clean isn't today's work
    .order("window_start");
  const seriesIds = [...new Set((visits.data ?? []).map((v) => v.series_id))];
  const series = seriesIds.length
    ? await supabase.from("series").select("id, property_id, status").in("id", seriesIds).eq("cleaner_id", session.userId)
    : { data: [], error: null };
  const propertyIds = [...new Set((series.data ?? []).map((s) => s.property_id))];
  const properties = propertyIds.length
    ? await supabase
        .from("properties")
        .select("id, address_line1, address_line2, town, postcode, latitude, longitude, bedrooms, bathrooms, pets, access_notes, key_code")
        .in("id", propertyIds)
    : { data: [], error: null };

  if (visits.error || series.error || properties.error) {
    return (
      <>
        {header(0)}
        <ErrorState>Today&rsquo;s jobs didn&rsquo;t load. Check your signal and refresh. If you&rsquo;re on your way, call the Ping office.</ErrorState>
      </>
    );
  }

  const propertyFor = new Map<string, Property>();
  const seriesProperty = new Map((series.data ?? []).map((s) => [s.id, s.property_id]));
  for (const p of properties.data ?? []) propertyFor.set(p.id, p);
  const onHold = new Set((series.data ?? []).filter((s) => s.status === "paused").map((s) => s.id));
  const jobs = (visits.data ?? []).map((v) => ({
    ...v,
    property: propertyFor.get(seriesProperty.get(v.series_id) ?? "") ?? null,
    onHold: v.status === "scheduled" && onHold.has(v.series_id),
  }));

  return (
    <>
      {header(jobs.length)}
      {jobs.length === 0 ? (
        <EmptyState
          title="A free day"
          action={<Link href="/work/jobs" className={buttonClass("secondary", "lg")}>See new jobs</Link>}
        >
          Nothing&rsquo;s booked for you today. Claimed cleans show up here on the day, with the address and directions.
        </EmptyState>
      ) : (
        <ol className="grid gap-6 lg:grid-cols-2 lg:gap-8">
          {jobs.map((j, i) => (
            <li key={j.id} className="grid">
              <TodayJob n={i + 1} job={j} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

type Job = {
  id: string;
  window_start: string;
  window_end: string;
  duration_minutes: number;
  status: Enums<"visit_status">;
  cleaner_earnings_pence: number;
  property: Property | null;
  onHold: boolean;
};

function TodayJob({ n, job }: { n: number; job: Job }) {
  const st = VISIT_STATUS[job.status];
  const live = LIVE.includes(job.status) && !job.onHold;
  const p = job.property;

  return (
    <article aria-labelledby={`visit-${job.id}`} className={cn("grid content-start overflow-hidden rounded-lg ring-1", live ? "bg-card shadow-card ring-line/70" : "bg-mist/70 ring-line")}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6 sm:px-8 sm:pt-8">
        <div className="flex items-baseline gap-4">
          <span className="font-display text-xl font-semibold text-navy-3 tabular">{String(n).padStart(2, "0")}</span>
          <p className="font-display text-3xl font-semibold tabular">{formatWindow(job.window_start, job.window_end)}</p>
        </div>
        {job.onHold ? <Badge tone="warn">On hold</Badge> : <Badge tone={st.tone}>{st.label}</Badge>}
      </header>
      <p className="flex flex-wrap gap-x-3 px-6 pt-1 text-navy-2 sm:px-8">
        <span>Arrive in this window · {formatDuration(job.duration_minutes)}</span>
        {p ? <span className="font-semibold text-navy">You earn {formatPence(job.cleaner_earnings_pence)}</span> : null}
      </p>

      {!p ? (
        <div className="m-6 grid gap-2 rounded-md bg-warn-soft p-5 sm:m-8">
          <p id={`visit-${job.id}`} className="text-lg font-semibold text-warn">This clean is with the Ping office now</p>
          <p className="text-navy-2">It&rsquo;s no longer on your list, so the address has been taken off your phone. Call the office if you think that&rsquo;s wrong.</p>
        </div>
      ) : !live ? (
        <div className="grid gap-1 px-6 py-6 sm:px-8 sm:py-8">
          <h2 id={`visit-${job.id}`} className="text-xl font-semibold">{p.address_line1}, {p.town}</h2>
          <p className="text-navy-2">
            {job.status === "completed"
              ? "All done. Thank you."
              : job.onHold
                ? "On hold, so don't go. The Ping office is sorting something out with the customer, and it isn't paid while it's on hold."
                : "Not going ahead today. Nothing to do."}
          </p>
          {job.status === "completed" ? (
            <Link href={`/work/visit/${job.id}`} className="mt-2 inline-flex min-h-12 items-center font-semibold text-navy underline decoration-line decoration-2 underline-offset-4">
              See what you sent
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <div className="grid gap-5 px-6 py-6 sm:px-8 sm:py-8">
            <address className="grid gap-0.5 not-italic">
              <h2 id={`visit-${job.id}`} className="text-2xl font-semibold">{p.address_line1}</h2>
              {p.address_line2 ? <span className="text-lg">{p.address_line2}</span> : null}
              <span className="text-lg">{p.town}</span>
              <span className="text-lg font-semibold tracking-wide tabular">{p.postcode}</span>
            </address>
            <a
              href={directionsUrl(p)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("primary", "xl", "w-full")}
            >
              <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
                <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <circle cx="12" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
              <span>Directions</span>
            </a>
            {job.status === "scheduled" ? (
              <StartButton visitId={job.id} goTo={`/work/visit/${job.id}`} />
            ) : (
              <Link href={`/work/visit/${job.id}`} className={buttonClass("ink", "xl", "w-full")}>
                Carry on: checklist and photos
              </Link>
            )}
          </div>

          <dl className="grid gap-5 border-t border-line/70 bg-mist/40 px-6 py-6 sm:px-8">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-navy-3">Home</dt>
                <dd className="font-semibold">{p.bedrooms} bed · {p.bathrooms} bath</dd>
              </div>
              <div>
                <dt className="text-sm text-navy-3">Pets</dt>
                <dd className="font-semibold">{p.pets?.trim() || "None"}</dd>
              </div>
            </div>
            <div>
              <dt className="text-sm text-navy-3">Getting in</dt>
              <dd className="mt-1 rounded-md bg-mist/70 px-4 py-3 text-lg">{p.access_notes?.trim() || "No access notes. Knock or ring when you arrive."}</dd>
            </div>
            {p.key_code?.trim() ? (
              <div>
                <dt className="sr-only">Key code</dt>
                <dd><KeyCode code={p.key_code.trim()} /></dd>
              </div>
            ) : null}
          </dl>
        </>
      )}
    </article>
  );
}
