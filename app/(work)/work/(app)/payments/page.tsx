import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, ErrorState, NavyPanel, PageHeader } from "@/components/ui";
import { buttonClass } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { PAYMENTS_COPY, paymentsStep, STRIPE_COLUMNS } from "../../_lib/payments";
import { SetupButton } from "./setup-button";

export const metadata: Metadata = { title: "Getting paid" };

const NEEDS = [
  { title: "Photo ID", note: "Your passport or driving licence. Stripe checks it, not Ping." },
  { title: "Your bank details", note: "Sort code and account number, for the account your earnings go to." },
  { title: "A few details about you", note: "Name, date of birth and home address, as a self-employed cleaner." },
];

const HOW = [
  { n: "1", title: "You finish a clean", note: "Tap Complete in the app. The customer's card is charged for that clean." },
  { n: "2", title: "Your earnings land in your Stripe account", note: "Exactly the amount shown on the job. Ping's fee is taken separately, never out of what you were shown." },
  { n: "3", title: "Stripe pays your bank", note: "Once the clean's check period has passed, your earnings are sent to your bank account." },
];

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ back?: string; retry?: string }> }) {
  const session = await requireRole("cleaner", "/work/payments");
  const { back, retry } = await searchParams;
  const supabase = await createClient();
  const { data: me, error } = await supabase.from("cleaners").select(`status, ${STRIPE_COLUMNS}`).eq("id", session.userId).maybeSingle();

  const header = <PageHeader eyebrow="Getting paid" title="Your payments." />;
  if (error) {
    return (
      <>
        {header}
        <ErrorState>Your payments set-up didn&rsquo;t load. Check your signal and refresh.</ErrorState>
      </>
    );
  }
  if (me?.status !== "active") {
    return (
      <>
        {header}
        <EmptyState title="Payments open once you're approved">
          When the Ping team has checked your documents, you&rsquo;ll set up how you get paid here.{" "}
          <Link href="/work" className="font-semibold text-navy underline underline-offset-4">See your application</Link>
        </EmptyState>
      </>
    );
  }

  const step = paymentsStep(me);
  const copy = PAYMENTS_COPY[step];
  const ready = step === "ready";

  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-8">
        <NavyPanel className="grid gap-7 p-7 pb-24 sm:p-10 sm:pb-28" data-payments-step={step}>
          <Badge tone={copy.tone} className="justify-self-start">{copy.badge}</Badge>
          <div className="grid gap-4">
            <h2 className="font-display text-3xl font-semibold leading-[1.05] text-white sm:text-4xl">{copy.title}</h2>
            <p className="max-w-xl text-lg text-on-navy/85">{copy.body}</p>
          </div>
          {retry ? (
            <p role="alert" className="rounded-md bg-white/10 px-5 py-4 font-medium text-white">
              Stripe didn&rsquo;t open that time. Try the button again.
            </p>
          ) : null}
          {back && step === "started" ? (
            <p role="status" className="rounded-md bg-white/10 px-5 py-4 font-medium text-white">
              You left Stripe before the end. Nothing is lost.
            </p>
          ) : null}
          {ready ? (
            <Link href="/work/jobs" className={buttonClass("signal", "xl", "w-full sm:w-auto sm:justify-self-start")}>
              See new jobs
            </Link>
          ) : null}
          {copy.action ? <SetupButton label={copy.action} quiet={ready} /> : null}
        </NavyPanel>

        {ready ? (
          <Card className="grid gap-6">
            <h2 className="text-xl font-semibold">How you get paid.</h2>
            <ol className="grid gap-5">
              {HOW.map((s) => (
                <li key={s.n} className="grid grid-cols-[2.75rem_1fr] gap-4">
                  <span aria-hidden className="grid size-11 place-items-center rounded-full bg-teal-soft font-display text-lg font-semibold text-teal-ink tabular">{s.n}</span>
                  <div className="grid gap-1">
                    <span className="text-lg font-semibold">{s.title}</span>
                    <span className="text-navy-2">{s.note}</span>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        ) : (
          <Card className="grid gap-6">
            <div className="grid gap-2">
              <h2 className="text-xl font-semibold">Have these to hand.</h2>
              <p className="text-navy-2">About five minutes on your phone.</p>
            </div>
            <ul className="grid gap-5">
              {NEEDS.map((n) => (
                <li key={n.title} className="grid grid-cols-[1.75rem_1fr] gap-4">
                  <svg viewBox="0 0 24 24" className="mt-0.5 size-7 text-teal-deep" aria-hidden>
                    <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div className="grid gap-1">
                    <span className="text-lg font-semibold">{n.title}</span>
                    <span className="text-navy-2">{n.note}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="border-t border-line pt-5 text-sm text-navy-2">
              Your ID and bank details go to Stripe, never to Ping. We only see whether you&rsquo;re ready to be paid.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
