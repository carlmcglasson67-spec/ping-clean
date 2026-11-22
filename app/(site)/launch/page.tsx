import type { Metadata, Route } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { ButtonLink, LogoMark } from "@/components/ui";
import { BLOCK_SIZE_MAX } from "@/lib/booking";
import { interestFormSetup } from "@/lib/interest/server";
import type { LaunchKind } from "@/lib/interest/launch";
import { Eyebrow } from "../_components/blocks";
import { FaqList } from "../_components/faq-list";
import { LaunchInterest } from "../_components/launch-interest";
import { STANDARD_CLEAN, STANDARD_CLEAN_COUNT } from "../_content/checklist";
import { AREA_GROUPS, AREAS_LINK } from "../_content/nav";
import type { Faq } from "../_content/faq";

export const metadata: Metadata = {
  title: "Launching soon",
  description:
    "Ping Clean is regular home cleaning for Carlisle and West Cumbria: one vetted cleaner for your block, a checklist and photos every visit, and you pay after. Register your interest as a customer or to clean with Ping.",
};

// The form's retention period and Turnstile key are read on every request.
export const dynamic = "force-dynamic";

const registerHref = (as: LaunchKind) => `/launch?as=${as}#register` as Route;

/** What it is, in three numbers. Each is a rule of the product, not a boast. */
const FACTS = [
  { value: "1", label: "cleaner for your block", note: "The same person for every clean you book, so they learn your home." },
  { value: String(BLOCK_SIZE_MAX), label: "cleans in a block, at most", note: "Book a block, not a contract. When it ends you rebook, or you don’t." },
  { value: "0", label: "charges before the clean", note: "Your card is saved when you book and charged only once the clean is done." },
];

/**
 * Why it's different: what people are used to, then what Ping does instead. None of these
 * repeats the three facts above (one cleaner, blocks of 8, pay after).
 */
const DIFFERENT: { old: string; title: string; body: string; fragment: "checks" | "checklist" | "rate" | "cover" }[] = [
  { old: "Taking it on trust that someone’s been checked.", title: "4 checks before any job.", body: "All 4 are verified by a person at Ping before a cleaner sees a single home.", fragment: "checks" },
  { old: "No real idea what was done while you were out.", title: "A checklist and photos, every visit.", body: `${STANDARD_CLEAN_COUNT} ticks, room by room, with before and after photos you can look at even if you weren’t in.`, fragment: "checklist" },
  { old: "A price agreed on the doorstep, different for every home.", title: "One rate, set by Ping.", body: "The same fixed hourly rate in every town, shown before you book. Nobody haggles, and your cleaner sees what they’ll earn before they say yes.", fragment: "rate" },
  { old: "Your cleaner’s off, and you’re left to sort it out.", title: "Ping finds your cover.", body: "If your cleaner can’t make it, your clean goes straight back to vetted cleaners near you and we tell you who’s coming.", fragment: "cover" },
];
// Only what the page hasn't already said above: the numbers and the "elsewhere" rows cover the rest.
const FOR_CUSTOMERS = [
  "Every week or every two weeks, on the day that suits\u00a0you",
  "You see who’s coming before your first clean",
  "No need to be in: leave a key or a key safe code",
  "Rate every clean in a tap; the Ping team checks the photos\u00a0too",
];

const FOR_CLEANERS = [
  "Self-employed: you pick your areas, days and hours",
  "You see what you’ll earn before you take a home on",
  "Customers pay through Ping, so there’s no money to chase",
  "First refusal when your customer rebooks",
];

const LAUNCH_FAQ: Faq[] = [
  { q: "What is Ping Clean?", a: "Regular home cleaning for Carlisle and West Cumbria. You book a block of cleans, Ping offers it to vetted, self-employed cleaners near you, and one of them takes on every clean in the block. Ping handles the booking, the payment and the quality checks." },
  { q: "When does it launch, and where?", a: "Soon, starting in Carlisle and West Cumbria. We’re opening town by town, and the postcodes on this list help decide which come first. Leave yours and we’ll send you one message when booking opens near you." },
  { q: "What does registering commit me to?", a: "Nothing. There’s no payment and no booking. We keep your details only to send you that one message and to plan the launch, then delete them." },
  { q: "Will I get the same cleaner each time?", a: "Yes. One cleaner takes on your whole block, so the same person does every clean in it. When you rebook they’re offered it first. If they can’t take it, Ping finds a vetted replacement and tells you who’s coming." },
  { q: "How are Ping cleaners checked?", a: "Before a cleaner can see a single job we verify 4 things: a DBS check, public liability insurance, photo ID and their right to work in the UK. Then every clean they do is scored." },
  { q: "I’m a cleaner. Would I be employed by Ping?", a: "No. You’d be self-employed and run your own cleaning business. Ping introduces you to customers, handles booking and payment, and checks quality. You decide where, when and how much you work." },
];

export default async function LaunchPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const [sp, interest] = await Promise.all([searchParams, interestFormSetup()]);
  const initialKind: LaunchKind = sp.as === "cleaner" ? "cleaner" : "customer";

  return (
    <>
      {/* ------------------------------------------------------------ Hero */}
      <section aria-labelledby="launch-title" className="signal-waves relative overflow-hidden text-on-navy">
        <div className="mx-auto grid max-w-[96rem] gap-14 px-5 pb-40 pt-12 sm:px-10 sm:pt-16 lg:grid-cols-12 lg:gap-x-10 lg:px-16 lg:pb-44 lg:pt-16">
          <div className="rise lg:col-span-12">
            <p className="inline-flex w-fit items-center gap-3 rounded-full bg-white/8 py-2 pl-2 pr-5 text-base font-semibold text-on-navy-2 ring-1 ring-inset ring-white/15 lg:text-lg">
              <span className="relative grid size-7 place-items-center">
                <span aria-hidden className="ping-pulse absolute size-3 rounded-full bg-teal" />
                <LogoMark className="relative size-7" />
              </span>
              Launching soon in Carlisle and West Cumbria
            </p>
            <h1 id="launch-title" className="mt-10 text-[clamp(3rem,1.4rem+5vw,7.25rem)] font-semibold leading-[0.95]">
              The new way of connecting <br className="hidden lg:block" />
              <span className="text-brand-gradient-navy">cleaners to clients.</span>
            </h1>
          </div>

          <div className="rise flex flex-col [animation-delay:80ms] lg:col-span-6 lg:pt-2">
            <p className="max-w-[36rem] text-xl text-on-navy-2">
              Regular home cleaning, booked from your phone. One vetted cleaner for your whole block, a checklist and photos every visit, and you pay after it&rsquo;s done.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <ButtonLink href={registerHref("customer")} size="lg" variant="signal" className="max-sm:w-full">
                I want a cleaner
              </ButtonLink>
              <ButtonLink href={registerHref("cleaner")} size="lg" variant="onNavy" className="max-sm:w-full">
                I want to clean with Ping
              </ButtonLink>
            </div>
            <p className="mt-6 text-lg text-on-navy-2">Register your interest. No payment, no commitment.</p>
          </div>

          <PingSequence className="lg:col-span-6 lg:-mt-6" />
        </div>
      </section>

      {/* ------------------------------------------------------------ What it is */}
      <section aria-labelledby="what-title" className="bg-mist">
        <div className="mx-auto max-w-[96rem] px-5 py-20 sm:px-10 lg:px-16 lg:py-32">
          <div className="grid gap-8 lg:grid-cols-12 lg:gap-x-10">
            <Eyebrow className="lg:col-span-3 lg:pt-4">What Ping Clean is</Eyebrow>
            <h2 id="what-title" className="text-3xl font-semibold lg:col-span-9">
              You book a block of cleans. We <span className="text-brand-gradient">ping</span> it to vetted cleaners near you. One of them takes on your home.
            </h2>
          </div>
          {/* Stepped down the page, each a little wider than the last: never three equal boxes. */}
          <dl className="mt-14 grid gap-5 lg:mt-24 lg:grid-cols-[minmax(0,10fr)_minmax(0,11fr)_minmax(0,12fr)] lg:items-start">
            {FACTS.map((f, i) => (
              <div
                key={f.label}
                className={"lift flex flex-col rounded-xl bg-card p-8 shadow-card ring-1 ring-line/70 sm:p-10 lg:min-h-[30rem] " + (i === 1 ? "lg:mt-14" : i === 2 ? "lg:mt-28" : "")}
              >
                <dd className="order-1 font-display text-[clamp(4.5rem,2.5rem+6vw,8rem)] font-semibold leading-[0.85] tracking-[-0.05em] tabular">
                  {/* The signature gradient, ending on teal-deep so the right edge of the numeral holds on white. */}
                  <span className="bg-[linear-gradient(90deg,var(--color-blue)_0%,var(--color-teal-deep)_100%)] bg-clip-text text-transparent">{f.value}</span>
                </dd>
                <dt className="order-2 mt-4 font-display text-xl font-semibold">{f.label}</dt>
                <dd className="order-3 mt-3 max-w-sm text-lg text-navy-2">{f.note}</dd>
                <dd className="order-4 mt-auto pt-10">
                  <FactVisual which={i} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------------------ Why it's different */}
      <section aria-labelledby="different-title" className="scroll-mt-24">
        <div className="mx-auto max-w-[96rem] px-5 py-20 sm:px-10 lg:px-16 lg:py-32">
          <div className="grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-x-10">
            <div className="lg:col-span-8">
              <Eyebrow>Why it&rsquo;s different</Eyebrow>
              <h2 id="different-title" className="mt-5 text-3xl font-semibold">
                Built by people who <br className="hidden sm:block" />
                clean for a living.
              </h2>
            </div>
            <p className="text-lg text-navy-2 lg:col-span-4">
              Ping comes from a West Cumbria cleaning team, not a tech company. It&rsquo;s the service we wanted to work for, and the one we&rsquo;d book for our own homes.
            </p>
          </div>

          {/* A true before and after: what you're used to sits back; what Ping does stands forward. */}
          <ol className="mt-14 grid gap-5 lg:mt-24">
            {DIFFERENT.map((d) => (
              <li key={d.title} className="grid gap-2 lg:grid-cols-12 lg:gap-0">
                <div className="grid content-between gap-8 rounded-xl bg-mist p-8 sm:p-10 lg:col-span-4 lg:rounded-r-none lg:p-12">
                  <p className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.16em] text-navy-3">
                    <span aria-hidden className="grid size-7 place-items-center rounded-full bg-line text-navy-2">
                      <svg viewBox="0 0 20 20" className="size-4">
                        <path d="m6 6 8 8M14 6l-8 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                      </svg>
                    </span>
                    Elsewhere
                  </p>
                  <p className="font-display text-xl font-semibold tracking-[-0.02em] text-navy-2">&ldquo;{d.old}&rdquo;</p>
                </div>
                <div className="grid gap-8 rounded-xl bg-card p-8 shadow-card ring-1 ring-line/70 sm:p-10 lg:col-span-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,23rem)] lg:items-center lg:gap-x-12 lg:rounded-l-none lg:p-12">
                  <div>
                    <p className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.16em] text-teal-ink">
                      <span aria-hidden className="grid size-7 place-items-center rounded-full bg-teal text-navy">
                        <svg viewBox="0 0 20 20" className="size-4">
                          <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      With Ping
                    </p>
                    <h3 className="mt-5 text-2xl font-semibold">{d.title}</h3>
                    <p className="mt-4 max-w-xl text-lg text-navy-2">{d.body}</p>
                  </div>
                  <Fragment which={d.fragment} />
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------ Two sides */}
      <section aria-labelledby="sides-title" className="bg-mist">
        <div className="mx-auto max-w-[96rem] px-5 py-20 sm:px-10 lg:px-16 lg:py-32">
          <Eyebrow>Two sides, one Ping</Eyebrow>
          <h2 id="sides-title" className="mt-5 max-w-5xl text-3xl font-semibold">
            It has to work for the person doing the cleaning too.
          </h2>
          <div className="mt-14 grid gap-5 lg:mt-20">
            {/* Navy, full width: the words at real scale on the left, the product moment large on the right. */}
            <article className="signal-waves relative grid gap-12 overflow-hidden rounded-xl p-8 pb-24 text-on-navy sm:p-12 sm:pb-28 lg:grid-cols-12 lg:items-center lg:gap-x-10 lg:p-16 lg:pb-36">
              <div className="grid gap-10 lg:col-span-7">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal">For your home</p>
                  <h3 className="mt-5 text-3xl font-semibold">
                    Come home <br />
                    <span className="text-brand-gradient-navy">to it done.</span>
                  </h3>
                  <p className="mt-6 max-w-xl text-xl text-on-navy-2">The same cleaner, the same checklist, and photos to prove it, even when you&rsquo;re out.</p>
                </div>
                <TickList items={FOR_CUSTOMERS} tone="navy" className="sm:grid-cols-2 sm:gap-x-10 sm:gap-y-5" />
                <ButtonLink href={registerHref("customer")} size="lg" variant="signal" className="w-fit max-sm:w-full">
                  Register as a customer
                </ButtonLink>
              </div>
              {/* A moment from the customer app: what "done" looks like when you weren't in. */}
              <figure className="lg:col-span-5">
                <div aria-hidden className="rounded-lg bg-card p-5 text-navy shadow-lift sm:p-7">
                  <div className="flex items-center gap-4">
                    <span className="grid size-12 shrink-0 place-items-center rounded-full bg-ok-soft text-ok">
                      <svg viewBox="0 0 20 20" className="size-6">
                        <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <div>
                      <p className="font-display text-xl font-semibold leading-tight">Clean complete</p>
                      <p className="text-base text-navy-2 lg:text-lg">
                        {STANDARD_CLEAN_COUNT} of {STANDARD_CLEAN_COUNT} ticked
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 grid grid-cols-2 gap-3">
                    {["Before", "After"].map((label, n) => (
                      <PhotoSlot key={label} label={label} tone={n === 0 ? "mist" : "teal"} />
                    ))}
                  </div>
                  <ul className="mt-6 grid gap-3 border-t border-line pt-5">
                    {STANDARD_CLEAN.slice(0, 3).map((r) => (
                      <li key={r.room} className="grid grid-cols-[1.5rem_1fr] items-start gap-3 text-base text-navy-2 lg:text-lg">
                        <span className="mt-0.5 grid size-6 place-items-center rounded-full bg-teal-soft text-teal-ink">
                          <svg viewBox="0 0 20 20" className="size-3.5">
                            <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                        {r.items[0]}
                      </li>
                    ))}
                  </ul>
                </div>
                <figcaption className="mt-4 text-base text-on-navy-2 lg:text-lg">A preview of the customer app.</figcaption>
              </figure>
            </article>

            {/* Teal, mirrored: the product moment on the left, the words on the right. */}
            <article className="grain grid gap-12 rounded-xl bg-teal p-8 text-navy sm:p-12 lg:grid-cols-12 lg:items-center lg:gap-x-10 lg:p-16">
              <figure className="max-lg:order-2 lg:col-span-5">
                {/* A moment from the cleaner app: a block offered near you. No pay figure: that comes from settings. */}
                <div aria-hidden className="rounded-lg bg-card p-5 text-navy shadow-lift sm:p-7">
                  <div className="flex items-center gap-4">
                    <span className="relative grid size-12 shrink-0 place-items-center rounded-full bg-navy text-teal">
                      <span className="ping-pulse absolute size-3 rounded-full bg-teal" />
                      <LogoMark colour="current" className="relative size-7" />
                    </span>
                    <div>
                      <p className="font-display text-xl font-semibold leading-tight">New block near you</p>
                      <p className="text-base text-navy-2 lg:text-lg">Tuesday mornings, every week, {BLOCK_SIZE_MAX} cleans</p>
                    </div>
                  </div>
                  <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-line pt-5 text-base lg:text-lg">
                    <div>
                      <dt className="text-navy-2">Where</dt>
                      <dd className="font-semibold">Carlisle, CA2</dd>
                    </div>
                    <div>
                      <dt className="text-navy-2">Home</dt>
                      <dd className="font-semibold">3 bedrooms</dd>
                    </div>
                  </dl>
                  <p className="mt-5 rounded-md bg-canvas px-4 py-3 text-base font-semibold text-navy-2 ring-1 ring-inset ring-line lg:text-lg">
                    Take it on, or leave it for someone else.
                  </p>
                </div>
                <figcaption className="mt-4 text-base lg:text-lg">A preview of the cleaner app.</figcaption>
              </figure>
              <div className="grid gap-10 lg:col-span-6 lg:col-start-7">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.16em]">For cleaners</p>
                  <h3 className="mt-5 text-3xl font-semibold">
                    Pick your <br />
                    own work.
                  </h3>
                </div>
                <TickList items={FOR_CLEANERS} tone="teal" className="sm:grid-cols-2 sm:gap-x-10 sm:gap-y-5" />
                <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                  <ButtonLink href={registerHref("cleaner")} size="lg" variant="ink" className="max-sm:w-full">
                    Register to clean
                  </ButtonLink>
                  <Link href="/clean-for-ping" className="inline-flex min-h-12 items-center text-lg font-semibold underline decoration-navy/40 underline-offset-4 hover:decoration-navy">
                    How it works for cleaners
                  </Link>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Where: town by town */}
      <section aria-labelledby="where-title">
        <div className="mx-auto max-w-[96rem] px-5 py-20 sm:px-10 lg:px-16 lg:py-32">
          <div className="grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-x-10">
            <div className="lg:col-span-7">
              <Eyebrow>Where we&rsquo;re opening</Eyebrow>
              <h2 id="where-title" className="mt-5 text-3xl font-semibold">
                Carlisle and West Cumbria, town by town.
              </h2>
            </div>
            <p className="text-lg text-navy-2 lg:col-span-4 lg:col-start-9">
              We&rsquo;re opening one town at a time. The postcodes left on this list, by customers and by cleaners, help decide which come first.
            </p>
          </div>
          {AREA_GROUPS.map((g, gi) => (
            <div key={g.id} className={gi === 0 ? "mt-14 lg:mt-20" : "mt-10 lg:mt-14"}>
              <p className="mb-4 flex items-baseline justify-between gap-6 text-sm font-semibold uppercase tracking-[0.16em] text-navy-2">
                <span>{g.name}</span>
                <span className="normal-case tracking-normal text-navy-3 max-sm:hidden">{g.line}</span>
              </p>
              <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line ring-1 ring-line lg:grid-cols-3">
                {g.links.map((t) => (
                  <li key={t.label} className="bg-card">
                    <Link
                      href={t.href}
                      className="group flex min-h-24 items-center justify-between gap-x-4 gap-y-1 px-4 py-5 transition-colors duration-200 hover:bg-teal-soft max-sm:flex-col max-sm:items-start max-sm:justify-center sm:px-8 lg:min-h-28"
                    >
                      <span className="min-w-0 font-display text-lg font-semibold tracking-[-0.03em] sm:text-xl">{t.label}</span>
                      <span className="flex shrink-0 items-center gap-4 text-lg font-semibold text-teal-ink tabular">
                        {t.districts.join(", ")}
                        <span aria-hidden className="sm:hidden">&rarr;</span>
                        <span aria-hidden className="grid size-10 place-items-center max-sm:hidden rounded-full bg-canvas text-navy ring-1 ring-line transition-[transform,background-color] duration-300 ease-out-soft group-hover:translate-x-1 group-hover:bg-teal">
                          &rarr;
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
                {/* After the last region, a cell that closes the grid whatever the number of towns: it spans what is left of the row. */}
                {gi === AREA_GROUPS.length - 1 ? (
                  <li className={"bg-navy text-on-navy " + (g.links.length % 2 === 0 ? "max-lg:col-span-2 " : "") + (g.links.length % 3 === 1 ? "lg:col-span-2" : g.links.length % 3 === 0 ? "lg:col-span-3" : "")}>
                    <Link
                      href={registerHref("customer")}
                      className="group flex min-h-24 items-center justify-between gap-4 px-6 py-6 transition-colors duration-200 hover:bg-navy-800 sm:px-8 lg:min-h-28"
                    >
                      <span className="min-w-0">
                        <span className="block font-display text-xl font-semibold tracking-[-0.03em]">Your town not here?</span>
                        <span className="mt-1 block text-lg text-on-navy-2">Leave your postcode anyway. It tells us where to look next.</span>
                      </span>
                      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-teal text-navy transition-transform duration-300 ease-out-soft group-hover:translate-x-1">
                        &rarr;
                      </span>
                    </Link>
                  </li>
                ) : null}
              </ul>
            </div>
          ))}
          <Link href={AREAS_LINK.href} className="mt-8 inline-block py-3 text-lg font-semibold text-navy-2 hover:text-navy">
            What a Ping clean looks like in each&nbsp;town<span aria-hidden>&nbsp;&rarr;</span>
          </Link>
        </div>
      </section>

      {/* ------------------------------------------------------------ Register */}
      <section id="register" aria-label="Register your interest" className="group/register signal-waves relative scroll-mt-20 overflow-clip text-on-navy">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 pb-32 pt-20 sm:px-10 lg:grid-cols-12 lg:gap-x-10 lg:px-16 lg:pb-48 lg:pt-32">
          {/* The left column changes once the form is sent (the thanks card carries data-sent):
              it stops asking for what has just been done and says what happens next. */}
          <div className="lg:sticky lg:top-28 lg:col-span-5 lg:self-start">
            <Eyebrow tone="onInk">Register your interest</Eyebrow>
            <div className="group-has-[[data-sent]]/register:hidden">
              <h2 id="register-title" className="mt-5 text-3xl font-semibold">
                Be first in <span className="block text-brand-gradient-navy">when we launch.</span>
              </h2>
              <p className="mt-8 max-w-md text-xl text-on-navy-2">
                A postcode, one way to reach you and a tick put you on the list. The questions are optional, and they help decide where Ping opens first and how it works when it does.
              </p>
              <TickList
                className="mt-10"
                tone="navy"
                items={[
                  "No payment and no commitment",
                  "One message when Ping opens near\u00a0you",
                  interest.retentionMonths ? `Deleted after ${interest.retentionMonths} months, or sooner if you ask` : "Deleted whenever you ask",
                ]}
              />
            </div>
            <div className="hidden group-has-[[data-sent]]/register:block">
              <p className="mt-8 max-w-md text-xl text-on-navy-2">
                Your postcode now counts towards where Ping opens first. The next thing you hear from us is the one message that says we&rsquo;re open near you.
              </p>
              <TickList
                className="mt-10"
                tone="navy"
                items={[
                  "Nothing to pay and nothing more to do",
                  "Pass it on: every postcode counts",
                  interest.retentionMonths ? `Your details are deleted after ${interest.retentionMonths} months, or sooner if you ask` : "Your details are deleted whenever you ask",
                ]}
              />
            </div>
          </div>
          <div className="min-w-0 lg:col-span-7">
            {interest.retentionMonths === null ? (
              <div className="grid gap-4 rounded-xl bg-white/6 p-8 ring-1 ring-inset ring-white/15 sm:p-12">
                <p className="font-display text-2xl font-semibold">We&rsquo;re not taking names just now.</p>
                <p className="text-lg text-on-navy-2">The list is paused for a moment. Please come back soon.</p>
              </div>
            ) : (
              <LaunchInterest setup={interest} initialKind={initialKind} />
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Questions */}
      <section aria-labelledby="faq-title" className="bg-mist">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:gap-x-10 lg:px-16 lg:py-32">
          <div className="lg:col-span-5">
            <Eyebrow>Questions</Eyebrow>
            <h2 id="faq-title" className="mt-5 text-3xl font-semibold">
              Still wondering?
            </h2>
            <p className="mt-6 max-w-sm text-lg text-navy-2">The short answers are here. When you&rsquo;re ready, the list is one scroll up.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={registerHref("customer")} size="lg" variant="primary">
                Register as a customer
              </ButtonLink>
              <ButtonLink href={registerHref("cleaner")} size="lg" variant="secondary">
                Register to clean
              </ButtonLink>
            </div>
            <Link href="/faq" className="mt-6 inline-flex min-h-12 items-center gap-2 text-lg font-semibold text-navy-2 hover:text-navy">
              Every question, answered <span aria-hidden>&rarr;</span>
            </Link>
          </div>
          <div className="overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-line/70 lg:col-span-7 [&>div]:border-t-0 [&_details:last-child]:border-b-0 [&_summary]:[text-wrap:wrap]">
            <FaqList items={LAUNCH_FAQ} tone="card" />
          </div>
        </div>
      </section>
    </>
  );
}

function TickList({ items, tone, className }: { items: string[]; tone: "light" | "teal" | "navy"; className?: string }) {
  const tick = tone === "light" ? "bg-teal-soft text-teal-ink" : tone === "teal" ? "bg-navy text-teal" : "bg-teal text-navy";
  const text = tone === "light" ? "text-navy-2" : tone === "teal" ? "text-navy" : "text-on-navy-2";
  return (
    <ul className={"grid gap-4 " + (className ?? "")}>
      {items.map((item) => (
        <li key={item} className={"grid grid-cols-[1.75rem_1fr] items-start gap-4 text-lg " + text}>
          <span aria-hidden className={"mt-0.5 grid size-7 place-items-center rounded-full " + tick}>
            <svg viewBox="0 0 20 20" className="size-4">
              <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * The idea in one glance: a block is booked, the ping goes out, a cleaner takes it on.
 * Three moments from the app, stepping in one after another. An illustration of how a
 * booking will work, so it carries no price, no name and no photograph.
 */
function PingSequence({ className }: { className?: string }) {
  const steps = [
    { title: "Block booked", note: "Tuesdays, every week, 8 cleans", icon: "M4 6.5h12M4 6.5v9h12v-9M4 6.5v-2h12v2M7.5 3v2.5M12.5 3v2.5", shift: "lg:mr-28" },
    { title: "Ping sent", note: "Offered to vetted cleaners near you", icon: "", shift: "lg:ml-14 lg:mr-14" },
    { title: "Taken on", note: "Your cleaner for the whole block", icon: "m5 10.5 3.2 3L15 6.5", shift: "lg:ml-28" },
  ];
  return (
    <figure aria-label="How a booking will work: a block is booked, a ping goes to cleaners nearby, and one of them takes it on." className={"rise grid content-end gap-4 [animation-delay:200ms] " + (className ?? "")}>
      {steps.map((s, i) => (
        <div
          key={s.title}
          style={{ "--step": i, "--steps": steps.length } as CSSProperties}
          className={
            "step-signal grid grid-cols-[3.5rem_1fr] items-center gap-5 rounded-lg p-5 shadow-lift sm:p-6 " +
            s.shift +
            (i === 2 ? " bg-teal text-navy" : " bg-card text-navy ring-1 ring-line/70")
          }
        >
          <span className={"relative grid size-14 place-items-center rounded-md " + (i === 2 ? "bg-navy text-teal" : i === 1 ? "bg-navy text-teal" : "bg-mist text-blue")}>
            {i === 1 ? (
              <>
                <span aria-hidden className="ping-pulse absolute size-4 rounded-full bg-teal" />
                <LogoMark colour="current" className="relative size-8" />
              </>
            ) : (
              <svg viewBox="0 0 20 20" className="size-7" aria-hidden>
                <path d={s.icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <div>
            <p className="font-display text-xl font-semibold leading-tight">{s.title}</p>
            <p className={"mt-1 text-base lg:text-lg " + (i === 2 ? "text-navy" : "text-navy-2")}>{s.note}</p>
          </div>
        </div>
      ))}
      <figcaption className="pl-1 text-lg text-on-navy-2">How a booking will work at launch.</figcaption>
    </figure>
  );
}

/** One small engineered picture per fact, drawn from the tokens. Decorative: the words carry the meaning. */
function FactVisual({ which }: { which: number }) {
  const caption = "text-base font-semibold text-navy-2 lg:text-lg";
  if (which === 0) {
    // One cleaner, every visit: every clean in the block tied to the same person.
    const x = (n: number) => 16 + n * (288 / (BLOCK_SIZE_MAX - 1));
    return (
      <div aria-hidden className="grid gap-3">
        <p className={caption + " text-center"}>Your cleaner</p>
        <svg viewBox="0 0 320 96" className="w-full">
          {Array.from({ length: BLOCK_SIZE_MAX }, (_, n) => (
            <g key={n}>
              <path d={`M160 18 L${x(n)} 78`} fill="none" stroke="var(--color-teal-deep)" strokeWidth="2" strokeOpacity="0.7" />
              <circle cx={x(n)} cy="78" r="9" fill="var(--color-card)" stroke="var(--color-teal-deep)" strokeWidth="3" />
            </g>
          ))}
          <circle cx="160" cy="18" r="16" fill="var(--color-blue)" />
          <circle cx="160" cy="18" r="6" fill="var(--color-card)" />
        </svg>
        <p className={caption + " flex justify-between tabular"}>
          <span>Clean 1</span>
          <span>Clean {BLOCK_SIZE_MAX}</span>
        </p>
      </div>
    );
  }
  if (which === 1) {
    // A block: three done, the rest to come, then it ends.
    return (
      <div aria-hidden className="grid gap-4">
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${BLOCK_SIZE_MAX}, minmax(0, 1fr))` }}>
          {Array.from({ length: BLOCK_SIZE_MAX }, (_, n) => (
            <span key={n} className={"h-5 rounded-full " + (n < 3 ? "bg-blue " + (n === 2 ? "here" : "") : "bg-mist ring-1 ring-inset ring-navy-3/40")} />
          ))}
        </div>
        <p className={caption + " flex flex-wrap justify-between gap-x-4 tabular"}>
          <span>Clean 3 of {BLOCK_SIZE_MAX}</span>
          <span>Then rebook, or don&rsquo;t</span>
        </p>
      </div>
    );
  }
  // Booked, cleaned, then charged: the charge sits after the clean.
  const steps = ["Booked", "Cleaned", "Charged"];
  return (
    <ol aria-hidden className="grid grid-cols-3">
      {steps.map((label, n) => (
        <li key={label} className="relative grid justify-items-start gap-3">
          {n < 2 ? <span className="absolute left-6 right-0 top-[1.4rem] h-0.5 bg-navy-3/40" /> : null}
          <span className={"relative grid size-12 place-items-center rounded-full " + (n === 2 ? "bg-blue text-white" : "bg-teal-soft text-teal-ink")}>
            <svg viewBox="0 0 20 20" className="size-5">
              {n === 2 ? (
                <path d="M3.5 6.5h13v8h-13zM3.5 9.5h13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              ) : (
                <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </span>
          <span className={caption}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** A designed stand-in for a photograph the cleaner will take: never an invented photo. */
function PhotoSlot({ label, tone }: { label: string; tone: "mist" | "teal" }) {
  return (
    <div className={"relative grid aspect-[5/4] place-items-center sm:aspect-[4/3] overflow-hidden rounded-md ring-1 ring-inset ring-line " + (tone === "mist" ? "bg-mist" : "bg-teal-soft")}>
      {/* fine hatch, so the slot reads as a held place rather than a blank fill */}
      <span className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_10px,color-mix(in_srgb,var(--color-navy)_6%,transparent)_10px_11px)]" />
      <svg viewBox="0 0 24 24" className={"relative size-8 max-sm:-translate-y-3 " + (tone === "mist" ? "text-navy-3" : "text-teal-ink")}>
        <path d="M4 8.5h3l1.5-2h7l1.5 2h3v10H4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="12" cy="13.2" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      <span className="absolute bottom-2 left-2 rounded-full bg-card px-2.5 py-0.5 text-sm font-semibold text-navy-2 sm:bottom-2.5 sm:left-2.5 sm:px-3 sm:py-1 sm:text-base">{label}</span>
    </div>
  );
}

/** A small piece of the product beside each "With Ping" claim. Decorative. */
function Fragment({ which }: { which: "checks" | "checklist" | "rate" | "cover" }) {
  const tick = (
    <svg viewBox="0 0 20 20" className="size-3.5">
      <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (which === "checks") {
    return (
      <ul aria-hidden className="grid gap-2.5 min-[30rem]:grid-cols-2 lg:grid-cols-1">
        {["DBS check", "Insurance", "Photo ID", "Right to work"].map((c) => (
          <li key={c} className="flex min-h-14 items-center gap-3 rounded-md bg-canvas px-4 text-base font-semibold ring-1 ring-inset ring-line lg:text-lg">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ok-soft text-ok">{tick}</span>
            {c}
          </li>
        ))}
      </ul>
    );
  }
  if (which === "checklist") {
    return (
      <ul aria-hidden className="grid gap-2.5 rounded-md bg-canvas p-5 ring-1 ring-inset ring-line">
        {STANDARD_CLEAN.slice(0, 3).map((r) => (
          <li key={r.room} className="grid grid-cols-[1.5rem_1fr] items-start gap-3 text-base text-navy-2 lg:text-lg">
            <span className="mt-0.5 grid size-6 place-items-center rounded-full bg-teal-soft text-teal-ink">{tick}</span>
            {r.items[0]}
          </li>
        ))}
        <li className="mt-1 border-t border-line pt-3 text-base font-semibold text-navy tabular lg:text-lg">
          {STANDARD_CLEAN_COUNT} of {STANDARD_CLEAN_COUNT} ticked
        </li>
      </ul>
    );
  }
  if (which === "rate") {
    return (
      <div aria-hidden className="grid gap-2.5">
        <p className="flex min-h-14 items-center gap-3 rounded-md bg-canvas px-4 py-3 text-base font-semibold ring-1 ring-inset ring-line lg:text-lg">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-teal-soft text-teal-ink">{tick}</span>
          You see the rate before you book
        </p>
        <p className="flex min-h-14 items-center gap-3 rounded-md bg-canvas px-4 py-3 text-base font-semibold ring-1 ring-inset ring-line lg:text-lg">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-teal-soft text-teal-ink">{tick}</span>
          Your cleaner sees their pay before saying yes
        </p>
      </div>
    );
  }
  return (
    <div aria-hidden className="grid gap-3 rounded-md bg-canvas p-5 ring-1 ring-inset ring-line">
      <p className="flex items-center gap-3 text-base font-semibold lg:text-lg">
        <span className="relative grid size-8 shrink-0 place-items-center rounded-full bg-navy text-teal">
          <span className="ping-pulse absolute size-2.5 rounded-full bg-teal" />
          <LogoMark colour="current" className="relative size-5" />
        </span>
        Back with cleaners near you
      </p>
      <p className="flex items-center gap-3 border-t border-line pt-3 text-base font-semibold lg:text-lg">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ok-soft text-ok">{tick}</span>
        Taken on: you&rsquo;ll see who&rsquo;s coming
      </p>
    </div>
  );
}
