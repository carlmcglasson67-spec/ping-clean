import type { Metadata, Route } from "next";
import Link from "next/link";
import { Button, Card, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { requireRole } from "@/lib/auth/session";
import { formatStamp } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { LAUNCH_KINDS, LAUNCH_QUESTIONS, type LaunchKind } from "@/lib/interest/launch";
import { readAll, ROW_CAP } from "../_lib/read-all";
import { InterestList } from "./interest-list";

export const metadata: Metadata = { title: "Interest" };

const DISTRICT = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;

export default async function InterestPage({ searchParams }: { searchParams: Promise<{ district?: string; export?: string }> }) {
  await requireRole("admin", "/admin/interest");
  const sp = await searchParams;
  const wanted = (sp.district ?? "").trim().toUpperCase();
  const district = DISTRICT.test(wanted) ? wanted : null;
  const supabase = await createClient();

  const [counts, list, retention, told] = await Promise.all([
    supabase.rpc("admin_interest_counts"),
    // Every entry, in keyset pages (no 1,000-row cap), newest first again afterwards.
    readAll((after) => {
      const q = supabase.rpc("admin_list_interest", { p_district: district }).order("id").limit(ROW_CAP);
      return after ? q.gt("id", after) : q;
    }, "id").then((r) => ({ ...r, data: r.data?.sort((x, y) => y.registered_at.localeCompare(x.registered_at) || x.id.localeCompare(y.id)) ?? null })),
    supabase.rpc("interest_retention_months"),
    supabase.rpc("admin_interest_answer_counts"),
  ]);

  const header = (
    <PageHeader
      eyebrow="Register interest"
      title="Where people want Ping next."
      lede="Customers who asked for one message when Ping cleans near them, and people who want to clean with Ping. Contacts stay masked here: the full list only leaves in an export, and every look is logged."
    />
  );
  if (counts.error || list.error) {
    return <>{header}<ErrorState title="The interest list didn't load">Refresh the page. Nothing has been changed.</ErrorState></>;
  }

  const rows = counts.data ?? [];
  const total = rows.reduce((n, r) => n + r.signups, 0);
  const notTold = rows.reduce((n, r) => n + r.not_yet_notified, 0);
  const months = typeof retention.data === "number" ? retention.data : null;

  return (
    <>
      {header}
      {sp.export === "failed" ? (
        <div className="mb-8"><ErrorState title="The export didn't download">Try again. Nothing was sent anywhere.</ErrorState></div>
      ) : null}

      <ToldUs counts={told.data ?? []} failed={Boolean(told.error)} />

      <div className="grid gap-8 xl:grid-cols-[22rem_1fr] xl:items-start">
        <aside className="grid gap-6">
          <Card className="grid gap-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1"><span className="font-display text-3xl font-semibold tabular">{total}</span><span className="text-sm text-navy-2">signed up</span></div>
              <div className="grid gap-1"><span className="font-display text-3xl font-semibold tabular">{notTold}</span><span className="text-sm text-navy-2">not told yet</span></div>
            </div>
            <p className="text-sm text-navy-3">{months ? `Each entry is deleted ${months} months after it was made, or sooner on request.` : "Retention isn't set, so the form isn't taking sign-ups."} People who unsubscribed aren&rsquo;t counted.</p>
          </Card>

          <section aria-labelledby="districts" className="grid gap-3">
            <h2 id="districts" className="text-lg font-semibold">By postcode district</h2>
            {rows.length === 0 ? (
              <EmptyState title="No sign-ups yet">They arrive from the launch page, the instant price outside the launch area, and the &ldquo;booking opens soon&rdquo; page.</EmptyState>
            ) : (
              <ul className="grid gap-2">
                <li><DistrictLink href="/admin/interest" current={!district} label="All districts" n={total} /></li>
                {rows.map((r) => (
                  <li key={r.postcode_district}>
                    <DistrictLink href={`/admin/interest?district=${r.postcode_district}`} current={district === r.postcode_district} label={r.postcode_district}
                      n={r.signups} note={`${r.not_yet_notified} not told · newest ${formatStamp(r.newest)}`} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>

        <section aria-labelledby="people" className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="people" className="text-xl font-semibold">{district ? `${district}: ${list.data?.length ?? 0}` : `Everyone: ${list.data?.length ?? 0}`}</h2>
            <form action="/admin/interest/export" method="post" className="grid justify-items-start gap-2 sm:justify-items-end">
              <input type="hidden" name="district" value={district ?? ""} />
              <Button type="submit" variant="ink" disabled={!list.data?.length}>Export {district ?? "all"} as CSV</Button>
              <p className="max-w-xs text-sm font-semibold text-warn sm:text-right">Import directly into your SMS tool; don&apos;t re-save in Excel.</p>
            </form>
          </div>
          <p className="text-sm text-navy-3">The export holds full contact details. Keep it only as long as it takes to send the message, then delete it. Unsubscribed people are never in it.</p>
          {(list.data ?? []).length === 0 ? (
            <EmptyState title={district ? `Nobody in ${district}` : "Nobody on the list"}>When someone registers interest, they appear here with their contact masked.</EmptyState>
          ) : (
            <InterestList rows={list.data ?? []} />
          )}
        </section>
      </div>
    </>
  );
}

function DistrictLink({ href, current, label, n, note }: { href: string; current: boolean; label: string; n: number; note?: string }) {
  return (
    <Link href={href as Route} aria-current={current ? "page" : undefined}
      className={cn("flex min-h-12 items-center justify-between gap-4 rounded-md px-4 py-3 ring-1 ring-inset", current ? "bg-navy text-on-navy ring-navy" : "bg-card ring-line hover:ring-navy-3")}>
      <span className="grid">
        <span className="font-semibold">{label}</span>
        {note ? <span className={cn("text-xs", current ? "text-on-navy-2" : "text-navy-3")}>{note}</span> : null}
      </span>
      <span className="font-display text-xl font-semibold tabular">{n}</span>
    </Link>
  );
}

type AnswerCount = { kind: LaunchKind; question: string; answer: string; people: number };

const KIND_TITLE: Record<LaunchKind, string> = { customer: "Customers", cleaner: "People who want to clean" };

/**
 * "What people told us": the launch page's answers, tallied. Bars are scaled to the most
 * popular answer of each question, so a glance shows what matters. Counts only: no
 * contacts, and never the free-text note (that is in the export).
 */
function ToldUs({ counts, failed }: { counts: AnswerCount[]; failed: boolean }) {
  if (failed) {
    return <div className="mb-8"><ErrorState title="The answers didn&rsquo;t load">Refresh the page. The list below is unaffected.</ErrorState></div>;
  }
  if (counts.length === 0) return null;
  return (
    <section aria-labelledby="told-us" className="mb-10 grid gap-5">
      <h2 id="told-us" className="text-xl font-semibold">What people told us</h2>
      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        {LAUNCH_KINDS.map((kind) => {
          const mine = counts.filter((c) => c.kind === kind);
          if (mine.length === 0) return null;
          return (
            <Card key={kind} className="grid gap-7">
              <h3 className="text-lg font-semibold">{KIND_TITLE[kind]}</h3>
              {LAUNCH_QUESTIONS[kind].map((q) => {
                const rows = q.options
                  .map((o) => ({ label: o.label, people: mine.find((c) => c.question === q.key && c.answer === o.value)?.people ?? 0 }))
                  .sort((a, b) => b.people - a.people);
                const top = Math.max(1, ...rows.map((r) => r.people));
                if (rows.every((r) => r.people === 0)) return null;
                return (
                  <div key={q.key} className="grid gap-2">
                    <p className="text-sm font-semibold text-navy-2">{q.label}</p>
                    <ul className="grid gap-1.5">
                      {rows.map((r) => (
                        <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-3 text-sm">
                          <span className="relative grid min-h-9 items-center overflow-hidden rounded-sm bg-mist px-3">
                            <span aria-hidden className="absolute inset-y-0 left-0 rounded-sm bg-teal-soft" style={{ width: `${(r.people / top) * 100}%` }} />
                            <span className="relative truncate font-semibold">{r.label}</span>
                          </span>
                          <span className="text-right font-display text-base font-semibold tabular">{r.people}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
