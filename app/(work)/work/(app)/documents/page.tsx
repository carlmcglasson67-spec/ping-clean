import type { Metadata } from "next";
import { Badge, Card, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatDay, formatStamp } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { DOCUMENT_KIND, DOCUMENT_STATUS } from "@/lib/labels";
import { DOC_GUIDE, REQUIRED_DOCS } from "../../_lib/documents";
import { latestByKind } from "../../_lib/latest";
import { DocumentUpload } from "./document-upload";

export const metadata: Metadata = { title: "Your documents" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireRole("cleaner", "/work/documents");
  const { view } = await searchParams;
  const supabase = await createClient();
  const [{ data: docs, error }, { data: me }] = await Promise.all([
    supabase
      .from("cleaner_documents")
      .select("id, kind, status, expires_on, rejection_reason, created_at")
      .eq("cleaner_id", session.userId)
      .order("created_at", { ascending: false }),
    supabase.from("cleaners").select("status").eq("id", session.userId).maybeSingle(),
  ]);
  const canUpload = me?.status === "applicant" || me?.status === "active";
  const latest = latestByKind(docs ?? []);

  return (
    <>
      <PageHeader
        eyebrow="Your documents"
        title="Four checks, then you're in."
        lede="Every Ping cleaner sends the same four. They go to a private folder only you and the Ping team can open."
      />

      {view === "failed" ? (
        <div className="mb-8">
          <ErrorState title="That document didn't open">
            It may still be uploading, or your signal dropped. Try again in a moment.
          </ErrorState>
        </div>
      ) : null}

      {error ? (
        <ErrorState>Your documents didn&rsquo;t load. Check your signal and refresh.</ErrorState>
      ) : (
        <ol className="grid gap-5 lg:grid-cols-2 lg:gap-6">
          {REQUIRED_DOCS.map((kind, i) => {
            const doc = latest.get(kind);
            const st = doc ? DOCUMENT_STATUS[doc.status] : null;
            const needsNew = !doc || doc.status === "rejected" || doc.status === "expired";
            return (
              <li key={kind} className="grid">
                <Card className="grid content-start gap-5">
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-display text-2xl font-semibold text-ink-3 tabular">{String(i + 1).padStart(2, "0")}</span>
                      {st ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge>Not sent yet</Badge>}
                    </div>
                    <h2 className="text-xl font-semibold">{DOCUMENT_KIND[kind]}</h2>
                    <p className="text-ink-2">{DOC_GUIDE[kind].hint}</p>
                  </div>

                  {doc ? (
                    <dl className="grid gap-3 rounded-md bg-paper-2/70 p-4 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-ink-3">Sent</dt>
                        <dd className="font-semibold">{formatStamp(doc.created_at)}</dd>
                      </div>
                      {doc.expires_on ? (
                        <div>
                          <dt className="text-ink-3">{kind === "insurance" ? "Cover ends" : "Expires"}</dt>
                          <dd className="font-semibold">{formatDay(doc.expires_on)}</dd>
                        </div>
                      ) : null}
                      {doc.status === "rejected" && doc.rejection_reason ? (
                        <div className="sm:col-span-2">
                          <dt className="text-ink-3">What the Ping team said</dt>
                          <dd className="font-semibold text-bad">{doc.rejection_reason}</dd>
                        </div>
                      ) : null}
                      <div className="sm:col-span-2">
                        {/* A plain link: the route signs a 10-minute URL at the moment it's tapped. */}
                        <a
                          href={`/work/documents/${doc.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-12 items-center gap-2 font-semibold text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-ink"
                        >
                          View what you sent
                          <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                            <path d="M8 16 16 8m0 0H9.5M16 8v6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </a>
                      </div>
                    </dl>
                  ) : null}

                  {canUpload ? (
                    needsNew || doc?.status === "verified" ? (
                      <DocumentUpload kind={kind} cleanerId={session.userId} replacing={!needsNew} />
                    ) : (
                      <p className="text-sm text-ink-3">We&rsquo;re checking this one, and we&rsquo;ll let you know as soon as it&rsquo;s done.</p>
                    )
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
