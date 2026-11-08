import type { Metadata, Route } from "next";
import Link from "next/link";
import { ButtonLink, LogoMark } from "@/components/ui";
import { Crumbs, Eyebrow, Rings, StepList, Tick } from "../_components/blocks";
import { FaqList } from "../_components/faq-list";
import { Photo } from "../_components/photo";
import type { Faq } from "../_content/faq";
import { CLEANER_STEPS, TIERS } from "../_content/how";

export const metadata: Metadata = {
  title: "Clean for Ping",
  description:
    "Self-employed cleaning work in West Cumbria. Choose your areas and hours, take on blocks of regular cleans, and get paid after every clean.",
  alternates: { canonical: "/clean-for-ping" },
};

const BENEFITS = [
  { title: "Your areas, your hours", body: "You’re self-employed. Pick the postcode districts you’ll travel to and the days you work. Ping never sets your hours or makes you take a job." },
  { title: "Blocks that stay yours", body: "You take on a block of up to 8 cleans, not a one-off. Same house, same day, and when the customer rebooks you get first refusal." },
  { title: "You see the pay first", body: "Every job on your board shows exactly what you’ll earn before you take it on. No haggling with customers over price." },
  { title: "No chasing money", body: "Customers pay through Ping. Your earnings go straight to your bank once each clean clears." },
];

const NEEDS = [
  { title: "A DBS check", body: "A current DBS certificate. If you haven’t got one, we’ll point you to how to apply." },
  { title: "Public liability insurance", body: "Cover in your own name for cleaning work in people’s homes." },
  { title: "Photo ID", body: "Passport or photocard driving licence." },
  { title: "Right to work in the UK", body: "Checked the same way an employer would check it." },
  { title: "A smartphone", body: "The Ping app is where you find jobs, tick the checklist and take photos." },
];

const CLEANER_FAQ: Faq[] = [
  {
    q: "Am I employed by Ping?",
    a: "No. You’re self-employed and run your own cleaning business. Ping introduces you to customers, handles booking and payment, and checks quality. You decide where, when and how much you work.",
  },
  {
    q: "Who sets the price?",
    a: "Ping sets one fixed price for customers so nobody haggles on the doorstep. Every job on your board shows what you’ll earn from it before you decide.",
  },
  {
    q: "Can I turn work down?",
    a: "Always. Nothing is ever assigned to you without your say. If a home doesn’t suit you, leave it for someone else.",
  },
  {
    q: "What if I need to stop cleaning a home?",
    a: "Give notice in the app and the home goes back on the job board for another cleaner. Dropping homes at short notice affects your tier, so the customers who rely on you are looked after.",
  },
  {
    q: "When do I get paid?",
    a: "After each clean, once a short check period has passed in case the customer raises a problem. The money goes straight to your bank account.",
  },
];

export default function CleanForPingPage() {
  return (
    <>
      {/* ------------------------------------------------------------ Hero: signal */}
      <section className="px-5 pt-2 sm:px-10 lg:px-16">
        <div className="relative mx-auto grid max-w-[96rem] overflow-hidden rounded-xl bg-teal text-navy lg:grid-cols-12">
          <div className="grid content-between gap-12 p-8 sm:p-12 lg:col-span-7 lg:p-16 lg:pb-20">
            <div className="[&_a]:text-navy/70 [&_a:hover]:text-navy [&_[aria-current]]:text-navy [&_li]:text-navy/60">
              <Crumbs items={[{ href: "/", label: "Home" }, { label: "Clean for Ping" }]} />
            </div>
            <div>
              <LogoMark colour="navy" className="size-10" />
              <h1 className="mt-8 text-4xl font-semibold">
                Pick your
                <br />
                own work.
              </h1>
              <p className="mt-8 max-w-xl text-xl text-navy/85">
                Self-employed cleaning in West Cumbria, with blocks of regular cleans that are yours and pay that lands in your bank after every clean.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
                {/* /signup arrives with #19. */}
                <ButtonLink href={"/signup?next=/work/apply" as Route} size="lg" variant="ink">
                  Apply now
                </ButtonLink>
                <p className="text-base font-semibold">
                  Already have an account?{" "}
                  <Link href={"/login?next=/work/apply" as Route} className="underline decoration-navy/40 underline-offset-4 hover:decoration-navy">
                    Sign in
                  </Link>
                </p>
              </div>
            </div>
          </div>
          <Photo slot="cleaners-hero" tone="navy" caption="A Ping cleaner, between regulars" priority className="min-h-[24rem] rounded-none lg:col-span-5 lg:min-h-[44rem]" />
        </div>
      </section>

      {/* ------------------------------------------------------------ Benefits */}
      <section aria-labelledby="why-title">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-28">
          <div className="lg:col-span-4">
            <Eyebrow>Why cleaners choose Ping</Eyebrow>
            <h2 id="why-title" className="mt-5 text-3xl font-semibold">
              Your business. Less admin.
            </h2>
          </div>
          <ul className="grid gap-px overflow-hidden rounded-lg bg-line sm:grid-cols-2 lg:col-span-8">
            {BENEFITS.map((b, i) => (
              <li key={b.title} className="grid content-start gap-4 bg-card p-8 lg:p-10">
                <span className="font-display text-xl font-semibold text-teal-ink tabular">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-2xl font-semibold">{b.title}</h3>
                <p className="text-lg text-navy-2">{b.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------ Tiers: ink */}
      <section aria-labelledby="tiers-title" className="relative overflow-hidden signal-waves text-on-navy">
        <div className="mx-auto max-w-[96rem] px-5 py-20 sm:px-10 lg:px-16 lg:py-28">
          <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <Eyebrow tone="onInk">Three tiers</Eyebrow>
              <h2 id="tiers-title" className="mt-5 text-3xl font-semibold">
                Do great work, get first pick.
              </h2>
            </div>
            <p className="text-lg text-on-navy-2 lg:col-span-4 lg:col-start-9">
              Every new home goes to Top cleaners first, then Approved, then everyone. You move up on photo checks, customer ratings and turning up when you said you would.
            </p>
          </div>
          <ol className="mt-14 grid gap-4 lg:mt-20 lg:grid-cols-3 lg:gap-5">
            {TIERS.map((t, i) => (
              <li
                key={t.name}
                className={
                  "relative flex flex-col overflow-hidden rounded-lg p-8 lg:p-10 " +
                  (i === 2 ? "bg-teal text-navy" : i === 1 ? "bg-blue text-white" : "bg-navy-800")
                }
              >
                <div className="flex items-center gap-2" aria-hidden>
                  {[0, 1, 2].map((d) => (
                    <span key={d} className={"size-3 rounded-full " + (d <= i ? (i === 2 ? "bg-navy" : i === 1 ? "bg-white" : "bg-teal") : i === 2 ? "bg-navy/20" : "bg-white/25")} />
                  ))}
                </div>
                <div className="mt-20 lg:mt-36">
                  <h3 className="font-display text-[clamp(3rem,2rem+3vw,5rem)] font-semibold leading-none tracking-[-0.04em]">{t.name}</h3>
                  <p className={"mt-5 text-lg " + (i === 2 ? "text-navy/85" : i === 1 ? "text-white" : "text-on-navy-2")}>{t.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <Rings className="-bottom-80 -right-56 size-[48rem] text-on-navy/[0.05]" />
      </section>

      {/* ------------------------------------------------------------ Steps + photo */}
      <section aria-labelledby="steps-title">
        <div className="mx-auto max-w-[96rem] px-5 py-20 sm:px-10 lg:px-16 lg:py-28">
          <Eyebrow>How it works</Eyebrow>
          <h2 id="steps-title" className="mt-5 max-w-4xl text-3xl font-semibold">
            From application to your first regular.
          </h2>
          <div className="mt-14 grid gap-12 lg:mt-20 lg:grid-cols-12 lg:gap-10">
            <div className="lg:sticky lg:top-32 lg:col-span-5 lg:self-start">
              <Photo slot="cleaners-app" tone="mist" caption="The job board, on a cleaner’s phone" className="aspect-[4/5]">
                {/* A job card as it appears on the cleaner's board: the shape, never real data. */}
                <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-lg bg-card p-6 text-navy shadow-lift ring-1 ring-line/70 sm:inset-x-10">
                  <p className="text-sm font-semibold uppercase tracking-[0.14em] text-teal-ink">New regular near you</p>
                  <p className="mt-3 font-display text-2xl font-semibold">Workington CA14</p>
                  <p className="mt-1 text-base text-navy-2">3 bedrooms · 8 cleans · Every week · Thursdays</p>
                  <div className="mt-5 flex items-center justify-between gap-4 border-t border-line pt-4">
                    <span className="text-base font-semibold text-navy-2">You see your earnings here</span>
                    <span className="inline-flex min-h-11 items-center rounded-full bg-teal px-4 text-base font-semibold">Take it on</span>
                  </div>
                </div>
              </Photo>
            </div>
            <div className="lg:col-span-6 lg:col-start-7">
              <StepList steps={CLEANER_STEPS} />
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ What you need */}
      <section aria-labelledby="needs-title" className="bg-mist/70">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-28">
          <div className="lg:col-span-4">
            <Eyebrow>What you’ll need</Eyebrow>
            <h2 id="needs-title" className="mt-5 text-3xl font-semibold">
              Five things, checked before your first job.
            </h2>
            <p className="mt-6 text-lg text-navy-2">Customers let you into their homes. These checks are why they can.</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:col-span-8 lg:gap-5">
            {NEEDS.map((n) => (
              <li key={n.title} className="grid grid-cols-[2rem_1fr] gap-4 rounded-lg bg-card p-7 shadow-card ring-1 ring-line/70 lg:p-8">
                <Tick />
                <div>
                  <h3 className="text-xl font-semibold">{n.title}</h3>
                  <p className="mt-2 text-lg text-navy-2">{n.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------ Questions */}
      <section aria-labelledby="cfaq-title">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-28">
          <div className="lg:col-span-4">
            <Eyebrow>Cleaners ask</Eyebrow>
            <h2 id="cfaq-title" className="mt-5 text-3xl font-semibold">
              The straight answers.
            </h2>
          </div>
          <div className="lg:col-span-7 lg:col-start-6">
            <FaqList items={CLEANER_FAQ} />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Close */}
      <section aria-labelledby="apply-title" className="px-5 pb-20 sm:px-10 lg:px-16 lg:pb-28">
        <div className="signal-waves relative mx-auto grid max-w-[96rem] gap-10 overflow-hidden rounded-xl p-8 text-on-navy sm:p-12 lg:grid-cols-12 lg:items-end lg:p-20">
          <Rings className="-right-40 -top-48 size-[36rem] text-on-navy/[0.08] lg:-right-24 lg:-top-56 lg:size-[46rem]" dot />
          <h2 id="apply-title" className="relative text-4xl font-semibold lg:col-span-8">
            Your round, your rules.
          </h2>
          <div className="relative grid gap-6 lg:col-span-4">
            <p className="text-lg text-on-navy-2">Create your account, upload your documents and we&rsquo;ll check everything before your first job.</p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
              <ButtonLink href={"/signup?next=/work/apply" as Route} size="lg" variant="signal">
                Apply now
              </ButtonLink>
              <p className="text-base text-on-navy-2">
                Already have an account?{" "}
                <Link href={"/login?next=/work/apply" as Route} className="font-semibold text-teal underline decoration-teal/40 underline-offset-4 hover:text-on-navy">
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
