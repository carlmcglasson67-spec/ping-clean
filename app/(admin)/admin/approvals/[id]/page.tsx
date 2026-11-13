import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatDay, formatStamp, todayInLondon, weekdayName } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { DOCUMENT_KIND, DOCUMENT_STATUS, TIER } from "@/lib/labels";
import { pgUuid } from "../../_lib/ids";
import { latestByKind, readiness, REQUIRED_DOCS } from "../_lib/vetting";
import { DecisionPanel } from "./decision-panel";
import { DocumentReview } from "./document-review";

export const metadata: Metadata = { title: "Cleaner" };

const STATUS = {
  applicant: { label: "Applicant", tone: "warn" },
  active: { label: "Working", tone: "ok" },
  suspended: { label: "Suspended", tone: "bad" },
  left: { label: "Left Ping", tone: "neutral" },
} as const;

const DECISION: Record<string, string> = {
  approve: "Approved",
  decline: "Declined",
  suspend: "Suspended",
  reactivate: "Put back to work",
  tier: "Tier changed",
};

type Slot = { day: number; from: string; to: string };

export default async function CleanerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  await requireRole("admin", "/admin/approvals");
  const id = pgUuid.safeParse((await params).id);
  if (!id.success) notFound();
  const { view } = await searchParams;
  const supabase = await createClient();
  const today = todayInLondon();

  const [cleaner, profile, docs, history] = await Promise.all([
    supabase.from("cleaners").select("id, status, tier, areas, availability, bio, approved_at, completed_visits, created_at").eq("id", id.data).maybeSingle(),
    supabase.from("profiles").select("full_name, email, phone").eq("id", id.data).maybeSingle(),
    supabase.from("cleaner_documents").select("id, cleaner_id, kind, status, expires_on, created_at, reviewed_at, rejection_reason").eq("cleaner_id", id.data).order("created_at", { ascending: false }),
    supabase.from("cleaner_reviews").select("id, decision, tier, reason, created_at").eq("cleaner_id", id.data).order("created_at", { ascending: false }).limit(20),
  ]);
  if (cleaner.error || profile.error || docs.error) {
    return <ErrorState title="This cleaner didn't load">Refresh the page. If it keeps happening, check the Supabase status page.</ErrorState>;
  }
  if (!cleaner.data) notFound();

  const c = cleaner.data;
  const name = profile.data?.full_name?.trim() || "Unnamed cleaner";
  const all = docs.data ?? [];
  const latest = latestByKind(all);
  const r = readiness(all, today);
  const slots = (Array.isArray(c.availability) ? (c.availability as Slot[]) : []).slice().sort((a, b) => a.day - b.day);

  return (
    <>
      <Link href={"/admin/approvals" as Route} className="mb-6 inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-blue">
        <span aria-hidden>←</span> All applicants and cleaners
      </Link>
      <PageHeader
        eyebrow={STATUS[c.status].label}
        title={name}
        lede={c.status === "applicant" ? `Applied ${formatStamp(c.created_at)}.` : `${TIER[c.tier]} tier · ${c.completed_visits} cleans done.`}
      />

      {view === "failed" ? (
        <div className="mb-8">
          <ErrorState title="That document didn't open">The file may not have finished uploading. Ask the cleaner to send it again if it keeps happening.</ErrorState>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_24rem] lg:items-start">
        <section aria-labelledby="docs" className="grid gap-4">
          <h2 id="docs" className="text-xl font-semibold">The four checks</h2>
          <ol className="grid gap-4">
            {REQUIRED_DOCS.map((kind, i) => {
              const doc = latest.get(kind);
              const older = all.filter((d) => d.kind === kind && d.id !== doc?.id);
              const expired = !!doc?.expires_on && doc.expires_on <= today;
              return (
                <li key={kind}>
                  <Card className="grid gap-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <span className="font-display text-2xl font-semibold text-navy-3 tabular">{String(i + 1).padStart(2, "0")}</span>
                        <div className="grid gap-1">
                          <h3 className="text-lg font-semibold">{DOCUMENT_KIND[kind]}</h3>
                          {doc ? (
                            <p className="text-sm text-navy-3">
                              Sent {formatStamp(doc.created_at)}
                              {doc.expires_on ? ` · ${kind === "insurance" ? "cover ends" : "expires"} ${formatDay(doc.expires_on)}` : ""}
                            </p>
                          ) : (
                            <p className="text-sm text-navy-3">Not sent yet</p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {doc ? <Badge tone={DOCUMENT_STATUS[doc.status].tone}>{doc.status === "pending" ? "To check" : DOCUMENT_STATUS[doc.status].label}</Badge> : <Badge>Missing</Badge>}
                        {expired ? <Badge tone="bad">Out of date</Badge> : null}
                      </div>
                    </div>
                    {doc ? (
                      <DocumentReview
                        documentId={doc.id}
                        status={doc.status}
                        openHref={`/admin/approvals/document/${doc.id}`}
                        rejectionReason={doc.status === "rejected" ? doc.rejection_reason : null}
                        outOfDate={expired}
                      />
                    ) : null}
                    {older.length ? (
                      <details className="text-sm text-navy-2">
                        <summary className="min-h-12 cursor-pointer content-center font-semibold text-navy">Earlier versions ({older.length})</summary>
                        <ul className="mt-2 grid gap-2">
                          {older.map((d) => (
                            <li key={d.id} className="flex flex-wrap items-center gap-3">
                              <span>{formatStamp(d.created_at)}</span>
                              <Badge tone={DOCUMENT_STATUS[d.status].tone}>{DOCUMENT_STATUS[d.status].label}</Badge>
                              <a href={`/admin/approvals/document/${d.id}`} target="_blank" rel="noreferrer" className="font-semibold text-blue">Open</a>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="grid gap-6 lg:sticky lg:top-28">
          <DecisionPanel cleanerId={c.id} status={c.status} tier={c.tier} ready={r.ready} waiting={r.waiting.map((k) => DOCUMENT_KIND[k])} />
          {history.data?.length ? (
            <Card className="grid gap-4">
              <h2 className="text-lg font-semibold">Decisions so far</h2>
              <ol className="grid gap-4 text-sm">
                {history.data.map((h) => (
                  <li key={h.id} className="grid gap-0.5">
                    <span className="font-semibold">
                      {DECISION[h.decision] ?? "Decision"}
                      {h.tier ? ` · ${TIER[h.tier]} tier` : ""}
                    </span>
                    <span className="text-navy-3">{formatStamp(h.created_at)}</span>
                    {h.reason ? <span className="break-words text-navy-2">{h.reason}</span> : null}
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
          <Card className="grid gap-4">
            <h2 className="text-lg font-semibold">Contact and work</h2>
            <dl className="grid gap-3 text-sm">
              <Row label="Email">{profile.data?.email ?? "Not given"}</Row>
              <Row label="Phone">{profile.data?.phone ?? "Not given"}</Row>
              <Row label="Areas">{c.areas.length ? c.areas.join(", ") : "None chosen yet"}</Row>
              <Row label="Days">
                {slots.length ? slots.map((s) => `${weekdayName(s.day).slice(0, 3)} ${s.from}–${s.to}`).join(" · ") : "Any day (none set)"}
              </Row>
              {c.bio ? <Row label="About">{c.bio}</Row> : null}
            </dl>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-navy-3">{label}</dt>
      <dd className="font-semibold break-words">{children}</dd>
    </div>
  );
}
