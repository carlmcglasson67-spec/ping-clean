import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, ErrorState, PageHeader } from "@/components/ui";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { createClient } from "@/lib/db/server";
import { DOCUMENT_KIND, DOCUMENT_STATUS } from "@/lib/labels";
import { REQUIRED_DOCS } from "../_lib/documents";
import { latestByKind } from "../_lib/latest";

type StepState = "done" | "todo" | "waiting";

/**
 * An applicant's home: where their application is up to, and the one thing to do next.
 * Applicants see no jobs and no addresses until the Ping team approves them.
 */
export async function Application({ name, cleanerId }: { name: string; cleanerId: string }) {
  const supabase = await createClient();
  const [profile, docs] = await Promise.all([
    supabase.from("profiles").select("full_name, phone").eq("id", cleanerId).maybeSingle(),
    supabase.from("cleaner_documents").select("kind, status, created_at").eq("cleaner_id", cleanerId),
  ]);

  const header = (
    <PageHeader
      eyebrow="Your application"
      title={`Thanks for applying, ${name}.`}
      lede="We check every cleaner before they see a single job. Here's where yours is up to."
    />
  );
  if (profile.error || docs.error) {
    return (
      <>
        {header}
        <ErrorState>Your application didn&rsquo;t load. Check your signal and refresh.</ErrorState>
      </>
    );
  }

  const latest = latestByKind(docs.data ?? []);
  const sent = REQUIRED_DOCS.filter((k) => {
    const s = latest.get(k)?.status;
    return s === "pending" || s === "verified";
  }).length;
  const verified = REQUIRED_DOCS.filter((k) => latest.get(k)?.status === "verified").length;
  const detailsDone = Boolean(profile.data?.full_name && profile.data?.phone);
  const docsState: StepState = sent === REQUIRED_DOCS.length ? (verified === REQUIRED_DOCS.length ? "done" : "waiting") : "todo";

  const next: { href: Route; label: string } | null = !detailsDone
    ? { href: "/work/details", label: "Add your details" }
    : docsState === "todo"
      ? { href: "/work/documents", label: sent === 0 ? "Send your documents" : "Send the rest" }
      : null;

  return (
    <>
      {header}
      <div className="grid gap-8 lg:grid-cols-[1fr_1.5fr] lg:gap-12">
        <div className="grid content-start gap-6">
          <section className="grain relative overflow-hidden rounded-lg bg-ink p-7 text-paper sm:p-9">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-signal">Checks complete</p>
            <p className="mt-5 font-display text-4xl font-semibold tabular">
              {verified}
              <span className="text-paper/40">/{REQUIRED_DOCS.length}</span>
            </p>
            <p className="mt-4 max-w-xs text-paper/70">
              When all four are verified, the Ping team approves you and jobs start appearing.
            </p>
            {next ? (
              <Link href={next.href} className={buttonClass("primary", "lg", "mt-8 w-full sm:w-auto")}>
                {next.label}
              </Link>
            ) : (
              <p className="mt-8 rounded-md bg-white/10 px-4 py-3 font-semibold">Nothing to do for now. We&rsquo;ll be in touch.</p>
            )}
          </section>
        </div>

        <ol className="grid content-start gap-3">
          <Step n={1} title="Your details" state={detailsDone ? "done" : "todo"} href="/work/details">
            {detailsDone ? "Name and mobile number saved." : "Your name and a mobile number we can reach you on."}
          </Step>
          <Step n={2} title="Your four documents" state={docsState} href="/work/documents">
            <ul className="mt-3 grid gap-2">
              {REQUIRED_DOCS.map((kind) => {
                const doc = latest.get(kind);
                const st = doc ? DOCUMENT_STATUS[doc.status] : null;
                return (
                  <li key={kind} className="flex items-center justify-between gap-3 border-t border-line/70 pt-2 first:border-0 first:pt-0">
                    <span className="text-ink">{DOCUMENT_KIND[kind]}</span>
                    {st ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge>Not sent yet</Badge>}
                  </li>
                );
              })}
            </ul>
          </Step>
          <Step n={3} title="Approval by the Ping team" state={verified === REQUIRED_DOCS.length ? "waiting" : "todo"}>
            Once your checks are verified, the Ping team looks everything over and switches on your job board.
          </Step>
        </ol>
      </div>
    </>
  );
}

function Step({ n, title, state, href, children }: { n: number; title: string; state: StepState; href?: Route; children: ReactNode }) {
  const badge = state === "done" ? <Badge tone="ok">Done</Badge> : state === "waiting" ? <Badge tone="warn">With us</Badge> : null;
  const body = (
    <>
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full font-display text-lg font-semibold tabular",
          state === "done" ? "bg-ok text-paper" : "bg-paper-2 text-ink-2",
        )}
        aria-hidden
      >
        {state === "done" ? (
          <svg viewBox="0 0 24 24" className="size-5">
            <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : n}
      </span>
      <div className="grid flex-1 gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          {badge}
        </div>
        <div className="text-ink-2">{children}</div>
      </div>
    </>
  );
  const card = "flex gap-5 rounded-lg bg-card p-5 shadow-card ring-1 ring-line/70 sm:p-6";
  return (
    <li>
      {href ? (
        <Link href={href} className={cn(card, "transition-shadow hover:shadow-lift")}>{body}</Link>
      ) : (
        <div className={card}>{body}</div>
      )}
    </li>
  );
}
