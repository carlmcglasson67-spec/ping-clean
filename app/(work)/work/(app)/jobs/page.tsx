import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, ErrorState, PageHeader, PingMark } from "@/components/ui";
import { buttonClass } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/session";
import { formatDay, formatWindow, todayInLondon, weekdayName } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { formatDuration, formatPence } from "@/lib/money";
import { firstVisitDate } from "../../_lib/schedule";
import { JobCard, type BoardJob } from "./job-card";

export const metadata: Metadata = { title: "New jobs" };

const RHYTHM = {
  weekly: (day: string) => `Every ${day}`,
  fortnightly: (day: string) => `Every other ${day}`,
  four_weekly: (day: string) => `Every four weeks, on a ${day}`,
} as const;

export default async function JobsPage() {
  const session = await requireRole("cleaner", "/work/jobs");
  const supabase = await createClient();
  const { data: me } = await supabase.from("cleaners").select("status, areas").eq("id", session.userId).maybeSingle();

  const header = (
    <PageHeader
      eyebrow="New jobs"
      title="Regular cleans in your areas."
      lede="Claim one and the customer is yours, visit after visit. You'll see the full address once it's yours."
    />
  );

  if (me?.status !== "active") {
    return (
      <>
        {header}
        <EmptyState title="Jobs appear once you're approved">
          The Ping team switches on your job board when your checks are done.{" "}
          <Link href="/work" className="font-semibold text-ink underline underline-offset-4">See your application</Link>
        </EmptyState>
      </>
    );
  }

  // job_board() is the only way a cleaner sees open work: their offers, town and district only.
  const { data, error } = await supabase.rpc("job_board");
  if (error) {
    return (
      <>
        {header}
        <ErrorState>New jobs didn&rsquo;t load. Check your signal and refresh.</ErrorState>
      </>
    );
  }

  const today = todayInLondon();
  const jobs: BoardJob[] = (data ?? []).map((j) => {
    const day = weekdayName(j.preferred_day);
    return {
      offerId: j.offer_id,
      seriesId: j.series_id,
      town: j.town,
      district: j.postcode_district,
      bedrooms: j.bedrooms,
      bathrooms: j.bathrooms,
      hasPets: j.has_pets,
      rhythm: RHYTHM[j.frequency](day),
      firstVisit: formatDay(firstVisitDate(j.starts_on, j.preferred_day, j.frequency, today)),
      window: formatWindow(j.window_start, j.window_end),
      hours: formatDuration(j.duration_minutes),
      earnings: formatPence(j.earnings_per_visit_pence),
      topFirst: j.offered_as === "top",
      urgent: j.status === "unclaimed",
    };
  });

  return (
    <>
      {header}
      {jobs.length === 0 ? (
        <EmptyState
          icon={<PingMark pulse className="text-ink" />}
          title="No new jobs right now"
          action={
            <Link href="/work/areas" className={buttonClass("secondary", "lg")}>
              {me.areas.length ? "Cover more areas" : "Choose your areas"}
            </Link>
          }
        >
          We&rsquo;ll ping you the moment a regular clean comes up in{" "}
          {me.areas.length ? me.areas.join(", ") : "your areas"}. More areas and days mean more jobs.
        </EmptyState>
      ) : (
        <ol className="grid gap-5 lg:grid-cols-2 lg:gap-6">
          {jobs.map((j) => (
            <li key={j.offerId} className="grid">
              <JobCard job={j} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
