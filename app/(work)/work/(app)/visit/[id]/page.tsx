import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { buttonClass } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/session";
import { formatDay, formatWindow, relativeDay, todayInLondon } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { VISIT_STATUS } from "@/lib/labels";
import { formatDuration, formatPence } from "@/lib/money";
import { directionsUrl } from "../../../_lib/directions";
import { pgUuid } from "../../../_lib/ids";
import { checklistProgress } from "../../../_lib/visit";
import { StartButton } from "./start-button";
import { VisitDay, type ExistingPhoto } from "./visit-day";

export const metadata: Metadata = { title: "Clean" };
// Carries the address while the job is held: always fresh, never cached (proxy.ts: no-store).
export const dynamic = "force-dynamic";

const SIGNED_FOR = 600; // seconds: thumbnails of the cleaner's own photos (ping-data-security rule 4)

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("cleaner", "/work/today");
  const id = pgUuid.safeParse((await params).id);
  if (!id.success) notFound();
  const supabase = await createClient();
  const today = todayInLondon();

  // Every read goes through RLS: the visit must be mine, the series mine, and the property
  // is only returned while I hold its series as an active cleaner.
  const { data: v, error } = await supabase
    .from("visits")
    .select("id, series_id, scheduled_date, window_start, window_end, duration_minutes, status, cleaner_earnings_pence, couldnt_do_count")
    .eq("id", id.data)
    .eq("cleaner_id", session.userId)
    .maybeSingle();
  if (error) return <ErrorState>This clean didn&rsquo;t load. Check your signal and refresh.</ErrorState>;
  if (!v) notFound();

  const [{ data: s }, { data: siblings }] = await Promise.all([
    supabase.from("series").select("id, property_id, block_size, status").eq("id", v.series_id).eq("cleaner_id", session.userId).maybeSingle(),
    supabase.from("visits").select("id, scheduled_date").eq("series_id", v.series_id).eq("cleaner_id", session.userId),
  ]);
  const { data: p } = s
    ? await supabase
        .from("properties")
        .select("id, address_line1, address_line2, town, postcode, latitude, longitude, access_notes, key_code")
        .eq("id", s.property_id)
        .maybeSingle()
    : { data: null };

  const n = (siblings ?? []).filter((x) => x.scheduled_date <= v.scheduled_date).length;
  const st = VISIT_STATUS[v.status];
  const isToday = v.scheduled_date === today;

  const header = (
    <PageHeader
      eyebrow={s ? `Clean ${n} of ${s.block_size}` : relativeDay(v.scheduled_date)}
      title={p ? p.address_line1 : "This clean"}
      lede={`${relativeDay(v.scheduled_date)} · arrive ${formatWindow(v.window_start, v.window_end)} · ${formatDuration(v.duration_minutes)} · you earn ${formatPence(v.cleaner_earnings_pence)}`}
      action={<Badge tone={st.tone}>{st.label}</Badge>}
    />
  );

  if (!p) {
    return (
      <>
        {header}
        <EmptyState title="This clean is with the Ping office now">
          It&rsquo;s no longer yours, so its address and checklist have been taken off your phone. Call the office if that&rsquo;s wrong.
        </EmptyState>
      </>
    );
  }

  if (v.status === "completed") {
    return (
      <>
        {header}
        <section className="grid gap-4 rounded-lg bg-ok-soft p-7 ring-1 ring-ok/25 sm:p-9">
          <p className="font-display text-3xl font-semibold text-ok">Done. Thank you.</p>
          <p className="text-navy-2">
            {v.couldnt_do_count
              ? `${v.couldnt_do_count} item${v.couldnt_do_count === 1 ? "" : "s"} marked “couldn't do”: the customer can see your reasons.`
              : "Every item ticked. The customer can see your checklist and photos."}
          </p>
          <Link href="/work/today" className={buttonClass("ink", "lg", "w-full sm:w-auto sm:justify-self-start")}>Back to today</Link>
        </section>
      </>
    );
  }

  if (v.status === "scheduled") {
    return (
      <>
        {header}
        <div className="grid gap-6 lg:max-w-2xl">
          <a href={directionsUrl(p)} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "xl", "w-full")}>
            Directions to {p.town}
          </a>
          {isToday ? (
            <StartButton visitId={v.id} />
          ) : (
            <EmptyState title={`Booked for ${formatDay(v.scheduled_date)}`}>
              You can start this clean on the day. Access notes and any key code appear then too.
            </EmptyState>
          )}
        </div>
      </>
    );
  }

  if (v.status !== "in_progress" || !isToday) {
    return (
      <>
        {header}
        <EmptyState title="Nothing to do here">
          {v.status === "in_progress"
            ? "This clean was left unfinished on its day. The Ping office has been told and will be in touch."
            : "This clean isn't going ahead."}
        </EmptyState>
      </>
    );
  }

  // In progress, today: the checklist and photos.
  const [{ data: items, error: itemsError }, { data: photos }] = await Promise.all([
    supabase.from("checklist_items").select("id, room, label, position, done, skipped_reason").eq("visit_id", v.id).order("position"),
    supabase.from("visit_photos").select("id, kind, storage_path").eq("visit_id", v.id).eq("uploaded_by", session.userId).order("created_at"),
  ]);
  if (itemsError) {
    return (
      <>
        {header}
        <ErrorState>The checklist didn&rsquo;t load. Check your signal and refresh: nothing you&rsquo;ve ticked is lost.</ErrorState>
      </>
    );
  }
  const signed = photos?.length
    ? (await supabase.storage.from("visit-photos").createSignedUrls(photos.map((x) => x.storage_path), SIGNED_FOR)).data ?? []
    : [];
  const urlFor = new Map(signed.map((x) => [x.path, x.signedUrl]));
  const existing: ExistingPhoto[] = (photos ?? []).map((x) => ({ id: x.id, kind: x.kind, url: urlFor.get(x.storage_path) ?? null }));
  const progress = checklistProgress(items ?? []);

  return (
    <>
      {header}
      <p className="-mt-4 mb-8 text-navy-2">
        {p.access_notes?.trim() ? <>Getting in: <span className="font-semibold text-navy">{p.access_notes.trim()}</span></> : null}
      </p>
      {/* A phone-shaped column even on a desktop: it's a checklist, read top to bottom. */}
      <div className="max-w-3xl">
        <VisitDay
          visitId={v.id}
          items={(items ?? []).map((i) => ({ id: i.id, room: i.room, label: i.label, done: i.done, reason: i.skipped_reason }))}
          photos={existing}
          key={`${v.id}-${progress.total}`}
        />
      </div>
    </>
  );
}
