import type { Metadata, Route } from "next";
import { Badge, ButtonLink, Card, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatDay, formatStamp } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { formatDuration } from "@/lib/money";
import { orderQueue, pageOf, readAll, ROW_CAP } from "./_lib/queue";
import { ScoreForm } from "./score-form";

export const metadata: Metadata = { title: "QC" };

const TEN_MINUTES = 600; // signed photo links (ping-data-security rule 4)
const PAGE = 12; // cleans per page: every photo is signed on the way in

export default async function QcPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireRole("admin", "/admin/qc");
  const supabase = await createClient();
  const requested = Number((await searchParams).page ?? 1);

  // Every finished clean and every score, read in keyset pages so none is lost to the
  // 1,000-row cap; only light columns here. Shared request C-10 asks for a database
  // function to do this join (and paging) in one call.
  const [finished, scoredAll, recentQ] = await Promise.all([
    readAll((after) => {
      const q = supabase.from("visits").select("id, completed_at, couldnt_do_count").eq("status", "completed").order("id").limit(ROW_CAP);
      return after ? q.gt("id", after) : q;
    }, "id"),
    readAll((after) => {
      const q = supabase.from("visit_qc").select("visit_id").order("visit_id").limit(ROW_CAP);
      return after ? q.gt("visit_id", after) : q;
    }, "visit_id"),
    supabase.from("visit_qc").select("visit_id, score, reviewed_at").order("reviewed_at", { ascending: false }).limit(8),
  ]);
  if (finished.error || scoredAll.error || recentQ.error) return <Failed />;

  const waiting = orderQueue(finished.data ?? [], new Set((scoredAll.data ?? []).map((q) => q.visit_id)));
  const { page, pages, rows: pageRows } = pageOf(waiting, requested, PAGE);
  const recent = recentQ.data ?? [];
  const detailIds = [...new Set([...pageRows.map((v) => v.id), ...recent.map((r) => r.visit_id)])];
  const details = detailIds.length
    ? await supabase.from("visits").select("id, series_id, cleaner_id, scheduled_date, completed_at, duration_minutes, couldnt_do_count").in("id", detailIds)
    : { data: [], error: null };
  if (details.error) return <Failed />;
  const visitById = new Map((details.data ?? []).map((v) => [v.id, v]));
  const queue = pageRows.map((v) => visitById.get(v.id)).filter((v): v is NonNullable<typeof v> => !!v);
  const ids = queue.map((v) => v.id);

  const seriesIds = [...new Set((details.data ?? []).map((v) => v.series_id))];
  const [photos, items, reviews, series] = await Promise.all([
    ids.length ? supabase.from("visit_photos").select("id, visit_id, kind, room, storage_path, taken_at").in("visit_id", ids).order("taken_at") : empty(),
    ids.length ? supabase.from("checklist_items").select("visit_id, room, label, position, done, skipped_reason").in("visit_id", ids).order("position") : empty(),
    ids.length ? supabase.from("reviews").select("visit_id, rating, comment").in("visit_id", ids) : empty(),
    seriesIds.length ? supabase.from("series").select("id, property_id").in("id", seriesIds) : empty(),
  ]);
  if (photos.error || items.error || reviews.error || series.error) return <Failed />;

  const propIds = [...new Set((series.data ?? []).map((s) => s.property_id))];
  const cleanerIds = [...new Set((details.data ?? []).map((v) => v.cleaner_id).filter((x): x is string => !!x))];
  const [props, people, signed] = await Promise.all([
    propIds.length ? supabase.from("properties").select("id, town, postcode_district").in("id", propIds) : empty(),
    cleanerIds.length ? supabase.from("profiles").select("id, full_name").in("id", cleanerIds) : empty(),
    (photos.data ?? []).length
      ? supabase.storage.from("visit-photos").createSignedUrls((photos.data ?? []).map((p) => p.storage_path), TEN_MINUTES)
      : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[], error: null }),
  ]);

  const url = new Map<string, string>();
  for (const s of signed.data ?? []) if (s.path && s.signedUrl) url.set(s.path, s.signedUrl);
  const propOf = new Map((series.data ?? []).map((s) => [s.id, (props.data ?? []).find((p) => p.id === s.property_id)]));
  const name = new Map((people.data ?? []).map((p) => [p.id, p.full_name?.trim() || "Cleaner"]));
  const place = (seriesId: string) => {
    const p = propOf.get(seriesId);
    return p ? `${p.town} ${p.postcode_district}` : "Home";
  };

  return (
    <>
      <PageHeader eyebrow="Quality check" title="Every finished clean, scored." lede="Before and after photos, the checklist, and anything the cleaner couldn't do, with their reason. Flagged cleans come first." />

      <section aria-labelledby="queue" className="grid gap-4">
        <div className="flex items-baseline gap-3">
          <h2 id="queue" className="text-xl font-semibold">To score</h2>
          <span className="font-display text-xl font-semibold text-navy-3 tabular">{waiting.length}</span>
        </div>
        {queue.length === 0 ? (
          <EmptyState title="Every finished clean is scored">New cleans arrive here the moment the cleaner marks them complete.</EmptyState>
        ) : (
          <ul className="grid gap-6">
            {queue.map((v) => {
              const vItems = (items.data ?? []).filter((i) => i.visit_id === v.id);
              const skipped = vItems.filter((i) => i.skipped_reason);
              const ticked = vItems.filter((i) => i.done).length;
              const review = (reviews.data ?? []).find((r) => r.visit_id === v.id);
              const vPhotos = (photos.data ?? []).filter((p) => p.visit_id === v.id);
              return (
                <li key={v.id}>
                  <Card className="grid gap-6" aria-label={`${place(v.series_id)}, ${formatDay(v.scheduled_date)}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="grid gap-1">
                        <h3 className="text-xl font-semibold">{place(v.series_id)}</h3>
                        <p className="text-sm text-navy-3">
                          {formatDay(v.scheduled_date)} · {formatDuration(v.duration_minutes)} · {v.cleaner_id ? name.get(v.cleaner_id) : "No cleaner"}
                          {v.completed_at ? ` · finished ${formatStamp(v.completed_at)}` : ""}
                        </p>
                      </div>
                      {skipped.length ? <Badge tone="warn">{skipped.length} couldn&rsquo;t do</Badge> : <Badge tone="ok">Everything ticked</Badge>}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {(["before", "after"] as const).map((kind) => {
                        const list = vPhotos.filter((p) => p.kind === kind);
                        return (
                          <div key={kind} className="grid content-start gap-2">
                            <h4 className="text-sm font-semibold capitalize">{kind}</h4>
                            {list.length === 0 ? (
                              <p className="rounded-md bg-mist/70 px-4 py-6 text-sm text-navy-3">No {kind} photo.</p>
                            ) : (
                              <ul className="grid grid-cols-2 gap-2">
                                {list.map((p) => (
                                  <li key={p.id} className="grid gap-1">
                                    <a href={url.get(p.storage_path) ?? "#"} target="_blank" rel="noreferrer" className="block aspect-[4/3] overflow-hidden rounded-md bg-mist ring-1 ring-line">
                                      {url.get(p.storage_path) ? (
                                        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not an optimisable asset
                                        <img src={url.get(p.storage_path)} alt={`${kind} photo${p.room ? `, ${p.room}` : ""}`} referrerPolicy="no-referrer" className="size-full object-cover" />
                                      ) : (
                                        <span className="grid size-full place-items-center text-sm text-navy-3">Didn&rsquo;t load</span>
                                      )}
                                    </a>
                                    <span className="text-xs text-navy-3">{p.room ?? "Room not given"} · {formatStamp(p.taken_at)}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="grid gap-3 rounded-md bg-mist/60 p-4">
                      <p className="font-semibold">Checklist: {ticked} of {vItems.length} ticked{skipped.length ? `, ${skipped.length} couldn't do` : ""}</p>
                      {skipped.length ? (
                        <ul className="grid gap-2">
                          {skipped.map((i) => (
                            <li key={i.label} className="grid gap-0.5 rounded-md bg-warn-soft px-4 py-3">
                              <span className="text-sm font-semibold">{i.room}: {i.label}</span>
                              <span className="text-sm text-navy-2">&ldquo;{i.skipped_reason}&rdquo;</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <details className="text-sm">
                        <summary className="min-h-12 cursor-pointer content-center font-semibold">Every item</summary>
                        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                          {vItems.map((i) => (
                            <li key={i.label} className="flex gap-2">
                              <span aria-hidden className={i.done ? "text-ok" : "text-warn"}>{i.done ? "✓" : "–"}</span>
                              <span>{i.room}: {i.label}<span className="sr-only">{i.done ? ", ticked" : ", couldn't do"}</span></span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>

                    {review ? (
                      <p className="text-sm text-navy-2">
                        <span className="font-semibold text-navy">Customer rated it {review.rating} out of 5.</span>
                        {review.comment ? <> &ldquo;{review.comment}&rdquo;</> : null}
                      </p>
                    ) : (
                      <p className="text-sm text-navy-3">No customer rating yet.</p>
                    )}

                    <ScoreForm visitId={v.id} />
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
        {pages > 1 ? (
          <nav aria-label="Queue pages" className="flex flex-wrap items-center gap-3">
            {page > 1 ? <ButtonLink variant="secondary" href={`/admin/qc?page=${page - 1}` as Route}>Previous {PAGE}</ButtonLink> : null}
            <span className="text-sm text-navy-3">Page {page} of {pages} · {waiting.length} to score</span>
            {page < pages ? <ButtonLink variant="secondary" href={`/admin/qc?page=${page + 1}` as Route}>Next {PAGE}</ButtonLink> : null}
          </nav>
        ) : null}
      </section>

      <section aria-labelledby="recent" className="mt-14 grid gap-4">
        <h2 id="recent" className="text-xl font-semibold">Recently scored</h2>
        {recent.length === 0 ? (
          <EmptyState title="Nothing scored yet">Scores you give appear here, newest first.</EmptyState>
        ) : (
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-line">
              {recent.map((q) => {
                const v = visitById.get(q.visit_id);
                return (
                  <li key={q.visit_id} className="grid gap-1 px-6 py-4 sm:grid-cols-[5rem_1fr_1fr_auto] sm:items-center sm:gap-6">
                    <span className="font-display text-2xl font-semibold tabular">{q.score}<span className="text-base text-navy-3">/10</span></span>
                    <span>{v ? place(v.series_id) : "A clean"}</span>
                    <span className="text-navy-2">{v ? `${formatDay(v.scheduled_date)} · ${v.cleaner_id ? name.get(v.cleaner_id) : ""}` : ""}</span>
                    <span className="text-sm text-navy-3">{formatStamp(q.reviewed_at)}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </>
  );
}

function empty() {
  return Promise.resolve({ data: [] as never[], error: null });
}

function Failed() {
  return (
    <>
      <PageHeader eyebrow="Quality check" title="Every finished clean, scored." />
      <ErrorState title="The QC queue didn't load">Refresh the page. Nothing has been changed.</ErrorState>
    </>
  );
}
