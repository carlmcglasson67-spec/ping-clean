"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Button } from "@/components/ui";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CLAIM_COPY, type ClaimResult } from "../../_lib/claim";
import { claimJob } from "./actions";

/**
 * Exactly what a cleaner may see before claiming (ping-data-security rule 3): town,
 * postcode district, size, pets yes/no, day, time, hours and earnings. No street, no
 * access notes, no key code: job_board() never returns them, and nothing here asks.
 */
export type BoardJob = {
  offerId: string;
  seriesId: string;
  town: string;
  district: string;
  bedrooms: number;
  bathrooms: number;
  hasPets: boolean;
  /** Already worded: "Every Wednesday", "Every other Wednesday"… */
  rhythm: string;
  firstVisit: string;
  /** "4 cleans, last one 23 Dec": the true number they'd do if they took it now. */
  block: string;
  cleans: number;
  window: string;
  hours: string;
  earnings: string;
  topFirst: boolean;
  urgent: boolean;
  /** Their own customer has booked again, and they get first refusal. */
  firstRefusal: boolean;
};

export function JobCard({ job }: { job: BoardJob }) {
  const router = useRouter();
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [pending, start] = useTransition();

  const claim = () =>
    start(async () => {
      try {
        setResult(await claimJob({ offerId: job.offerId, seriesId: job.seriesId }));
      } catch {
        setResult({ ok: false, reason: "retry" });
      }
    });

  const closed = result && !result.ok && result.reason !== "retry";
  const won = result?.ok === true;

  return (
    <article
      aria-labelledby={`job-${job.offerId}`}
      className={cn(
        "grid min-w-0 gap-6 rounded-lg p-6 ring-1 transition-colors sm:p-8",
        won ? "bg-ok-soft ring-ok/30" : closed ? "bg-paper-2/70 ring-line" : "bg-card shadow-card ring-line/70",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h2 id={`job-${job.offerId}`} className="text-2xl font-semibold">
            {job.town} <span className="text-ink-3">{job.district}</span>
          </h2>
          <p className="text-ink-2">
            {job.bedrooms} bed · {job.bathrooms} bath · {job.hasPets ? "Pets at home" : "No pets"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {job.firstRefusal ? <Badge tone="signal">Your customer has booked again</Badge> : null}
          {job.urgent ? <Badge tone="warn">Needs a cleaner soon</Badge> : null}
          {job.topFirst && !job.firstRefusal ? <Badge tone="ink">Top cleaners first</Badge> : null}
        </div>
      </header>

      <p className="-mt-2 flex items-center gap-3 font-display text-xl font-semibold">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-base text-paper tabular" aria-hidden>{job.cleans}</span>
        {job.block}
      </p>
      {job.firstRefusal ? (
        <p className="-mt-2 rounded-md bg-signal-soft px-4 py-3 text-signal-ink">
          You cleaned here last time, so it&rsquo;s yours first if you want it. Same home, a new block.
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-line/70 py-5 sm:grid-cols-3">
        <div className="col-span-full flex flex-wrap items-baseline gap-x-3">
          <dt className="w-full text-sm text-ink-3">You earn</dt>
          <dd className="font-display text-4xl font-semibold tabular">{job.earnings}</dd>
          <dd className="text-ink-2">a visit</dd>
        </div>
        <div className="col-span-full grid content-start gap-1 sm:col-span-1">
          <dt className="text-sm text-ink-3">When</dt>
          <dd className="font-semibold">{job.rhythm}</dd>
          <dd className="text-sm text-ink-2">First visit {job.firstVisit}</dd>
        </div>
        <div className="grid content-start gap-1">
          <dt className="text-sm text-ink-3">Arrive between</dt>
          <dd className="font-semibold tabular">{job.window}</dd>
        </div>
        <div className="grid content-start gap-1">
          <dt className="text-sm text-ink-3">Clean for</dt>
          <dd className="font-semibold">{job.hours}</dd>
        </div>
      </dl>

      {won ? (
        <div role="status" className="grid gap-4">
          <p className="text-xl font-semibold text-ok">It&rsquo;s yours: {job.block}. {job.rhythm}, starting {job.firstVisit}.</p>
          <p className="text-ink-2">{job.cleans === 1 ? "It's" : `All ${job.cleans} cleans are`} booked in for you now. The full address, access notes and any key code appear in Today on the day of each clean.</p>
          <Link href="/work" className={buttonClass("ink", "lg", "w-full sm:w-auto")}>See your week</Link>
        </div>
      ) : closed ? (
        <div role="status" className="grid gap-4">
          <div className="grid gap-1">
            <p className="text-lg font-semibold">{CLAIM_COPY[result.reason].title}</p>
            <p className="text-ink-2">{CLAIM_COPY[result.reason].body}</p>
          </div>
          <Button variant="secondary" size="lg" className="w-full sm:w-auto" onClick={() => router.refresh()}>
            Clear it from my list
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {result && !result.ok ? (
            <p role="alert" className="rounded-md bg-bad-soft px-4 py-3 font-medium text-bad">
              <span className="font-semibold">{CLAIM_COPY.retry.title}</span> {CLAIM_COPY.retry.body}
            </p>
          ) : null}
          <Button size="xl" pending={pending} onClick={claim} className="w-full">
            {pending ? "Claiming…" : job.cleans === 1 ? "Claim this clean" : `Claim these ${job.cleans} cleans`}
          </Button>
          <p className="text-center text-sm text-ink-3">
            {job.cleans === 1 ? "One clean." : `You take all ${job.cleans} cleans, not just the first.`} First to claim gets it.
          </p>
        </div>
      )}
    </article>
  );
}
