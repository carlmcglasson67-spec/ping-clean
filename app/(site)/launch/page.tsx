import type { Metadata, Route } from "next";
import Link from "next/link";
import { ButtonLink, LogoMark } from "@/components/ui";
import { interestFormSetup } from "@/lib/interest/server";
import type { LaunchKind } from "@/lib/interest/launch";
import { Eyebrow } from "../_components/blocks";
import { FaqList } from "../_components/faq-list";
import { LaunchInterest } from "../_components/launch-interest";
import { STANDARD_CLEAN_COUNT } from "../_content/checklist";
import { AREA_LINKS, AREAS_LINK } from "../_content/nav";
import type { Faq } from "../_content/faq";

export const metadata: Metadata = {
  title: "Launching soon",
  description:
    "Ping Clean is regular home cleaning for West Cumbria: one vetted cleaner for your block, a checklist and photos every visit, and you pay after. Register your interest as a customer or to clean with Ping.",
};

// The form's retention period and Turnstile key are read on every request.
export const dynamic = "force-dynamic";

const registerHref = (as: LaunchKind) => `/launch?as=${as}#register` as Route;

/** What it is, in three numbers. Each is a rule of the product, not a boast. */
const FACTS = [
  { value: "1", label: "cleaner for your block", note: "The same person for every clean you book, so they learn your home." },
  { value: "8", label: "cleans in a block, at most", note: "Book a block, not a contract. When it ends you rebook, or you don’t." },
  { value: "0", label: "charges before the clean", note: "Your card is saved when you book and charged only once the clean is done." },
];

/** Why it's different: what people are used to, then what Ping does instead. */
const DIFFERENT = [
  { old: "Open-ended contracts that are awkward to leave.", title: "Blocks of up to 8 cleans.", body: "Book a block. When it ends you rebook or you stop. Nobody is tied in, customer or cleaner." },
  { old: "Whoever happens to be free that week.", title: "One cleaner for your whole block.", body: "The same person does every clean in it. Rebook, and they’re offered your home before anyone else." },
  { old: "Taking it on trust that someone’s been checked.", title: "4 checks before any job.", body: "DBS, public liability insurance, photo ID and right to work, all verified before a cleaner sees a single home." },
  { old: "No real idea what was done while you were out.", title: "A checklist and photos, every visit.", body: `${STANDARD_CLEAN_COUNT} ticks, room by room, with before and after photos you can look at even if you weren’t in.` },
  { old: "Paying up front, or cash left on the side.", title: "You pay after, by card.", body: "Nothing is taken in advance. Your card is charged once the clean is finished." },
];

// Only what the page hasn't already said above: the numbers and the "elsewhere" rows cover the rest.
const FOR_CUSTOMERS = [
  "Every week or every two weeks, on the day that suits you",
  "You see who’s coming before your first clean",
  "No need to be in: leave a key or a key safe code",
  "Rate every clean in a tap; the Ping team checks the photos too",
];

const FOR_CLEANERS = [
  "Self-employed: you pick your areas, days and hours",
  "You see what you’ll earn before you take a home on",
  "Customers pay through Ping, so there’s no money to chase",
  "First refusal when your customer rebooks",
];

const LAUNCH_FAQ: Faq[] = [
  { q: "What is Ping Clean?", a: "Regular home cleaning for West Cumbria. You book a block of cleans, Ping offers it to vetted, self-employed cleaners near you, and one of them takes on every clean in the block. Ping handles the booking, the payment and the quality checks." },
  { q: "When does it launch, and where?", a: "Soon, starting in West Cumbria. We’re opening town by town, and the postcodes on this list help decide which come first. Leave yours and we’ll send you one message when booking opens near you." },
  { q: "What does registering my interest commit me to?", a: "Nothing. There’s no payment and no booking. We keep your details only to send you that one message and to plan the launch, then delete them." },
  { q: "Will I get the same cleaner each time?", a: "Yes. One cleaner takes on your whole block, so the same person does every clean in it. When you rebook they’re offered it first. If they can’t take it, Ping finds a vetted replacement and tells you who’s coming." },
  { q: "How are Ping cleaners checked?", a: "Before a cleaner can see a single job we verify four things: a DBS check, public liability insurance, photo ID and their right to work in the UK. Then every clean they do is scored." },
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
            <p className="inline-flex w-fit items-center gap-3 rounded-full bg-white/8 py-2 pl-2 pr-5 text-base font-semibold text-on-navy-2 ring-1 ring-inset ring-white/15">
              <span className="relative grid size-7 place-items-center">
                <span aria-hidden className="ping-pulse absolute size-3 rounded-full bg-teal" />
                <LogoMark className="relative size-7" />
              </span>
              Launching soon in West Cumbria
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
      <section aria-labelledby="what-title" className="border-b border-line bg-card">
        <div className="mx-auto max-w-[96rem] px-5 pt-20 sm:px-10 lg:px-16 lg:pt-32">
          <div className="grid gap-8 lg:grid-cols-12 lg:gap-x-10">
            <Eyebrow className="lg:col-span-3 lg:pt-4">What Ping Clean is</Eyebrow>
            <h2 id="what-title" className="text-3xl font-semibold lg:col-span-9">
              You book a block of cleans. We <span className="text-brand-gradient">ping</span> it to vetted cleaners near you. One of them takes on your home.
            </h2>
          </div>
        </div>
        <dl className="mx-auto mt-16 grid max-w-[96rem] border-t border-line sm:grid-cols-3 lg:mt-24">
          {FACTS.map((f, i) => (
            <div key={f.label} className={"grid content-start gap-2 px-5 py-10 sm:px-10 lg:px-16 lg:py-16 " + (i > 0 ? "border-t border-line sm:border-l sm:border-t-0" : "")}>
              <dt className="order-2 font-display text-xl font-semibold">{f.label}</dt>
              <dd className="order-1 font-display text-[clamp(4rem,2.5rem+5vw,7.5rem)] font-semibold leading-[0.9] tracking-[-0.04em] text-navy tabular">{f.value}</dd>
              <dd className="order-3 max-w-xs text-lg text-navy-2">{f.note}</dd>
            </div>
          ))}
        </dl>
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

          <ol className="mt-14 border-t border-line lg:mt-24">
            {DIFFERENT.map((d, i) => (
              <li key={d.title} className="grid gap-x-10 gap-y-5 border-b border-line py-9 lg:grid-cols-12 lg:py-12">
                <span aria-hidden className="font-display text-[3.25rem] font-semibold leading-none text-teal-deep tabular lg:col-span-2 lg:text-[4rem]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="text-lg text-navy-2 lg:col-span-4 lg:pt-2">
                  <span className="mb-2 block text-sm font-semibold uppercase tracking-[0.16em] text-navy-3">Elsewhere</span>
                  {d.old}
                </p>
                <div className="lg:col-span-6 lg:pt-2">
                  <p className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-teal-ink">With Ping</p>
                  <h3 className="text-2xl font-semibold">{d.title}</h3>
                  <p className="mt-4 max-w-xl text-lg text-navy-2">{d.body}</p>
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
          <div className="mt-14 grid gap-5 lg:mt-20 lg:grid-cols-12">
            <article className="flex flex-col justify-between gap-10 rounded-xl bg-card p-8 shadow-card ring-1 ring-line/70 sm:p-12 lg:col-span-7 lg:p-14">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-ink">For your home</p>
                <h3 className="mt-5 text-2xl font-semibold">Come home to it done.</h3>
              </div>
              <TickList items={FOR_CUSTOMERS} tone="light" />
              <ButtonLink href={registerHref("customer")} size="lg" variant="primary" className="w-fit">
                Register as a customer
              </ButtonLink>
            </article>
            <article className="flex flex-col justify-between gap-10 rounded-xl bg-teal p-8 text-navy sm:p-12 lg:col-span-5 lg:p-14">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em]">For cleaners</p>
                <h3 className="mt-5 text-2xl font-semibold">Pick your own work.</h3>
              </div>
              <TickList items={FOR_CLEANERS} tone="teal" />
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                <ButtonLink href={registerHref("cleaner")} size="lg" variant="ink">
                  Register to clean
                </ButtonLink>
                <Link href="/clean-for-ping" className="inline-flex min-h-12 items-center text-lg font-semibold underline decoration-navy/40 underline-offset-4 hover:decoration-navy">
                  How it works for cleaners
                </Link>
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
                West Cumbria, town by town.
              </h2>
            </div>
            <p className="text-lg text-navy-2 lg:col-span-4 lg:col-start-9">
              We&rsquo;re opening one town at a time. The postcodes left on this list, by customers and by cleaners, help decide which come first.
            </p>
          </div>
          <ul className="mt-14 grid gap-px overflow-hidden rounded-xl bg-line ring-1 ring-line sm:grid-cols-2 lg:mt-20 lg:grid-cols-3">
            {AREA_LINKS.map((t) => (
              <li key={t.label} className="bg-card">
                <Link
                  href={t.href}
                  className="group flex min-h-24 items-center justify-between gap-4 px-6 py-6 transition-colors duration-200 hover:bg-teal-soft sm:px-8 lg:min-h-28"
                >
                  <span className="min-w-0 font-display text-xl font-semibold tracking-[-0.03em]">{t.label}</span>
                  <span className="flex shrink-0 items-center gap-4 text-lg font-semibold text-teal-ink tabular">
                    {t.districts.join(", ")}
                    <span aria-hidden className="grid size-10 place-items-center rounded-full bg-canvas text-navy ring-1 ring-line transition-[transform,background-color] duration-300 ease-out-soft group-hover:translate-x-1 group-hover:bg-teal">
                      &rarr;
                    </span>
                  </span>
                </Link>
              </li>
            ))}
            {/* The last cell closes the grid whatever the number of towns: it spans what is left of the row. */}
            <li className={"bg-navy text-on-navy " + (AREA_LINKS.length % 2 === 0 ? "sm:max-lg:col-span-2 " : "") + (AREA_LINKS.length % 3 === 1 ? "lg:col-span-2" : AREA_LINKS.length % 3 === 0 ? "lg:col-span-3" : "")}>
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
          </ul>
          <Link href={AREAS_LINK.href} className="mt-8 inline-block py-3 text-lg font-semibold text-navy-2 hover:text-navy">
            What a Ping clean looks like in each town<span aria-hidden>&nbsp;&rarr;</span>
          </Link>
        </div>
      </section>

      {/* ------------------------------------------------------------ Register */}
      <section id="register" aria-labelledby="register-title" className="signal-waves relative scroll-mt-20 overflow-clip text-on-navy">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 pb-32 pt-20 sm:px-10 lg:grid-cols-12 lg:gap-x-10 lg:px-16 lg:pb-48 lg:pt-32">
          <div className="lg:sticky lg:top-28 lg:col-span-5 lg:self-start">
            <Eyebrow tone="onInk">Register your interest</Eyebrow>
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
                "One message when Ping opens near you",
                interest.retentionMonths ? `Deleted after ${interest.retentionMonths} months, or sooner if you ask` : "Deleted whenever you ask",
              ]}
            />
          </div>
          <div className="lg:col-span-7">
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
      <section aria-labelledby="faq-title" className="bg-card">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:gap-x-10 lg:px-16 lg:py-32">
          <div className="lg:col-span-4">
            <Eyebrow>Questions</Eyebrow>
            <h2 id="faq-title" className="mt-5 text-3xl font-semibold">
              Before you sign up.
            </h2>
            <p className="mt-6 max-w-sm text-lg text-navy-2">Ready? A postcode, one way to reach you and a tick, and you&rsquo;ll hear when Ping opens near you.</p>
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
          <div className="lg:col-span-8">
            <FaqList items={LAUNCH_FAQ} />
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
    <figure aria-label="How a booking will work: a block is booked, a ping goes to cleaners nearby, and one of them takes it on." className={"grid content-end gap-4 " + (className ?? "")}>
      {steps.map((s, i) => (
        <div
          key={s.title}
          style={{ animationDelay: `${260 + i * 220}ms` }}
          className={
            "rise grid grid-cols-[3.5rem_1fr] items-center gap-5 rounded-lg p-5 shadow-lift sm:p-6 " +
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
