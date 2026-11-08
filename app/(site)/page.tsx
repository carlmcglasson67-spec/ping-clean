import Link from "next/link";
import { ButtonLink, LogoMark } from "@/components/ui";
import { BeforeAfter } from "./_components/before-after";
import { ChecklistGrid, StepList } from "./_components/blocks";
import { FaqList } from "./_components/faq-list";
import { Photo } from "./_components/photo";
import { STANDARD_CLEAN_COUNT } from "./_content/checklist";
import { FEATURED_FAQ } from "./_content/faq";
import { STEPS } from "./_content/how";
import { InstantPrice } from "./_components/instant-price";
import { getPricing } from "./_lib/pricing";
import { AREA_LINKS, CLEANERS_LINK, FAQ_LINK } from "./_content/nav";

const STATS = [
  { value: "1", label: "cleaner for your block", note: "One person for every clean you book, not whoever is free." },
  { value: "4", label: "checks before any job", note: "DBS, insurance, photo ID and right to work." },
  { value: String(STANDARD_CLEAN_COUNT), label: "ticks on every clean", note: "A room-by-room checklist, with photos to prove it." },
  { value: "0", label: "charges before the clean", note: "Your card is saved at booking and charged only once it’s done." },
];


const PROMISES = [
  { title: "Your cleaner for the whole block", body: "One cleaner takes on every clean you book, so they learn your home. Rebook and they get first refusal." },
  { title: "Checked before they start", body: "Every Ping cleaner is DBS checked, insured and has their right to work verified before they see a single job." },
  { title: "Proof on every visit", body: "A room-by-room checklist and before and after photos on every clean, scored by our team." },
  { title: "Pay after, not before", body: "A fixed price agreed up front. Your card is charged only once the clean is finished." },
];

// The instant price reads the settings table on every request.
export const dynamic = "force-dynamic";

export default async function Home() {
  const pricing = await getPricing();
  return (
    <>
      {/* ------------------------------------------------------------ Hero */}
      <section aria-labelledby="hero-title" className="signal-waves relative overflow-hidden text-on-navy">
        <div className="mx-auto grid max-w-[96rem] gap-14 px-5 pb-24 pt-12 sm:px-10 sm:pt-16 lg:grid-cols-12 lg:gap-x-10 lg:gap-y-12 lg:px-16 lg:pb-32 lg:pt-14">
          {/* Headline across the full width; copy and tiles split unevenly beneath it. */}
          <div className="rise lg:col-span-12">
            <p className="inline-flex w-fit items-center gap-3 rounded-full bg-white/8 py-2 pl-2 pr-5 text-sm font-semibold text-on-navy-2 ring-1 ring-inset ring-white/15">
              <LogoMark className="size-7" />
              The new way of connecting cleaners to clients
            </p>
            <h1 id="hero-title" className="mt-10 text-[clamp(3rem,1.4rem+5vw,7.25rem)] font-semibold leading-[0.95] lg:mt-10">
              A cleaner home is just <br className="hidden md:block" />
              <span className="text-brand-gradient-navy">a Ping away.</span>
            </h1>
          </div>
          <div className="rise flex flex-col [animation-delay:80ms] lg:col-span-5 lg:pt-2">
            <p className="max-w-[34rem] text-xl text-on-navy-2">
              Book up to 8 cleans with one vetted, insured cleaner. A proper checklist and photos every visit. No contract; rebook any time.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <ButtonLink href="/#price" size="lg" variant="signal">
                Get your price
              </ButtonLink>
              <ButtonLink href="/#how" size="lg" variant="onNavy">
                See how it works
              </ButtonLink>
            </div>
          </div>

          {/* Image tiles, bleeding off the right edge on large screens. */}
          <div className="rise relative grid grid-cols-6 grid-rows-[repeat(6,minmax(0,1fr))] gap-3 [animation-delay:140ms] sm:gap-4 lg:col-span-7 lg:-mr-16 lg:h-[32rem]">
            <Photo slot="home-hero-kitchen" tone="cloud" caption="A kitchen, finished" priority className="col-span-4 row-span-6 min-h-[26rem] lg:min-h-0" />
            <Photo slot="home-hero-cleaner" tone="deep" caption="Your cleaner" className="col-span-2 row-span-3" />
            <Photo slot="home-hero-detail" tone="teal" caption="The detail" className="col-span-2 row-span-3" />

            {/* A moment from the customer app, floating over the photos. */}
            <div className="absolute -bottom-6 left-4 right-10 max-w-[22rem] rounded-lg bg-card p-5 text-navy shadow-lift ring-1 ring-line/70 sm:left-8 sm:p-6 lg:-bottom-10 lg:left-10">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-full bg-ok-soft text-ok">
                  <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
                    <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <p className="font-semibold leading-tight">Clean complete</p>
                  <p className="text-sm text-navy-3">Just now</p>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
                <div>
                  <p className="font-display text-2xl font-semibold tabular">
                    {STANDARD_CLEAN_COUNT}/{STANDARD_CLEAN_COUNT}
                  </p>
                  <p className="text-sm text-navy-2">checklist ticked</p>
                </div>
                <div>
                  <p className="font-display text-2xl font-semibold tabular">8</p>
                  <p className="text-sm text-navy-2">photos to look at</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Instant price */}
      <section id="price" aria-labelledby="price-title" className="scroll-mt-24 px-5 pb-16 pt-16 sm:px-10 lg:px-16 lg:pb-24 lg:pt-24">
        <div className="mx-auto max-w-[96rem]">
          {/* While prices are unset the panel speaks for itself; the heading would promise a number. */}
          <div className={pricing.status === "open" ? "mb-8 flex flex-wrap items-end justify-between gap-4 lg:mb-10" : "sr-only"}>
            <h2 id="price-title" className="text-2xl font-semibold">
              {pricing.status === "open" ? "Your price, before anything else." : "Instant price"}
            </h2>
            {pricing.status === "open" ? (
              <Link href="/price" className="inline-flex min-h-12 items-center gap-2 text-lg font-semibold text-navy-2 hover:text-navy">
                How pricing works <span aria-hidden>&rarr;</span>
              </Link>
            ) : null}
          </div>
          <InstantPrice pricing={pricing} />
        </div>
      </section>

      {/* ------------------------------------------------------------ Big stats */}
      <section aria-label="Ping in numbers" className="border-y border-line bg-card">
        <dl className="mx-auto grid max-w-[96rem] sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <div
              key={s.label}
              className={
                "grid content-start gap-2 px-5 py-10 sm:px-10 lg:px-12 lg:py-16 " +
                (i > 0 ? "border-t border-line sm:border-t-0 " : "") +
                (i % 2 === 1 ? "sm:border-l " : "") +
                (i >= 2 ? "sm:border-t lg:border-t-0 " : "") +
                (i === 2 ? "lg:border-l" : "")
              }
            >
              <dt className="order-2 font-display text-xl font-semibold">{s.label}</dt>
              <dd className="order-1 font-display text-[clamp(4rem,2.5rem+5vw,7.5rem)] font-semibold leading-[0.9] tracking-[-0.04em] text-navy tabular">{s.value}</dd>
              <dd className="order-3 max-w-xs text-base text-navy-2">{s.note}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ------------------------------------------------------------ How it works: before/after + steps */}
      <section id="how" aria-labelledby="how-title" className="scroll-mt-24">
        <div className="mx-auto max-w-[96rem] px-5 py-20 sm:px-10 lg:px-16 lg:py-32">
          <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-ink lg:col-span-12">How it works</p>
            <h2 id="how-title" className="text-3xl font-semibold lg:col-span-7">
              From postcode to a clean home in five steps.
            </h2>
            <p className="text-lg text-navy-2 lg:col-span-4 lg:col-start-9">
              No phone tag, no quotes to chase, no wondering if it got done. Every step happens in the Ping app.
            </p>
          </div>

          <div className="mt-14 grid gap-12 lg:mt-20 lg:grid-cols-12 lg:gap-10">
            <div className="lg:sticky lg:top-32 lg:col-span-6 lg:self-start">
              <BeforeAfter
                label="Drag to compare the room before and after"
                before={<Photo slot="home-before" tone="steel" caption="The kitchen on a Monday" className="aspect-[4/5] rounded-none [&_figcaption]:max-w-[calc(50%-1.5rem)]" />}
                after={<Photo slot="home-after" tone="mist" caption="Two hours later" captionSide="right" className="aspect-[4/5] rounded-none" />}
              />
              <p className="mt-4 text-base text-navy-3">Every clean comes with photos like these, in your account.</p>
            </div>

            <div className="lg:col-span-5 lg:col-start-8">
              <StepList steps={STEPS} />
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ What’s included */}
      <section id="included" aria-labelledby="included-title" className="scroll-mt-24 bg-mist/70">
        <div className="mx-auto grid max-w-[96rem] gap-14 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:gap-10 lg:px-16 lg:py-32">
          <div className="lg:col-span-4">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-ink">What&rsquo;s included</p>
            <h2 id="included-title" className="mt-5 text-3xl font-semibold">
              The same {STANDARD_CLEAN_COUNT}‑point clean, every visit.
            </h2>
            <p className="mt-6 text-lg text-navy-2">
              Your cleaner ticks each one off in the app as they go. Extras like oven cleans and ironing aren&rsquo;t part of a regular Ping clean yet.
            </p>
            <Photo slot="home-included-bathroom" tone="cloud" caption="A bathroom, after" className="mt-10 hidden aspect-[4/3] lg:block" />
          </div>

          <ChecklistGrid className="lg:col-span-8" />
        </div>
      </section>

      {/* ------------------------------------------------------------ Promises: ink */}
      <section id="promises" aria-labelledby="promises-title" className="relative scroll-mt-24 overflow-hidden signal-waves text-on-navy">
        <div className="mx-auto max-w-[96rem] px-5 py-20 sm:px-10 lg:px-16 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal">Why Ping</p>
              <h2 id="promises-title" className="mt-5 text-3xl font-semibold">
                Built so the clean is right, every time.
              </h2>
            </div>
            <ol className="grid gap-px overflow-hidden rounded-lg bg-line-navy sm:grid-cols-2 lg:col-span-8">
              {PROMISES.map((p, i) => (
                <li key={p.title} className="grid content-start gap-4 bg-navy p-8 lg:p-12">
                  <span className="font-display text-xl font-semibold text-teal tabular">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="text-2xl font-semibold">{p.title}</h3>
                  <p className="text-lg text-on-navy-2">{p.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <svg aria-hidden viewBox="0 0 600 600" className="pointer-events-none absolute -bottom-64 -left-48 size-[40rem] text-on-navy/[0.05]">
          {[90, 170, 250].map((r) => (
            <circle key={r} cx="300" cy="300" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
          ))}
        </svg>
      </section>

      {/* ------------------------------------------------------------ Areas: mist */}
      <section id="areas" aria-labelledby="areas-title" className="scroll-mt-24 bg-mist">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-32">
          <div className="lg:col-span-4">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-navy-2">Where Ping cleans</p>
            <h2 id="areas-title" className="mt-5 text-3xl font-semibold">
              West Cumbria first.
            </h2>
            <p className="mt-6 max-w-sm text-lg text-navy-2">
              Ten towns and the villages between them, from Maryport down the coast to Seascale. Ping cleaners choose the areas they cover, so the one who takes on your home wants to be there.
            </p>
          </div>
          <ul className="grid content-start gap-x-10 sm:grid-cols-2 lg:col-span-8">
            {AREA_LINKS.map((t) => (
              <li key={t.label} className="border-b border-navy/15">
                <Link href={t.href} className="group flex min-h-20 items-center justify-between gap-6 py-4">
                  <span className="font-display text-[clamp(1.75rem,1.2rem+1.6vw,2.75rem)] font-semibold leading-none transition-colors group-hover:text-teal-ink">
                    {t.label}
                  </span>
                  <span className="rounded-full bg-canvas/70 px-3 py-1 text-sm font-semibold text-navy-2 tabular">{t.districts.join(" ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------ Cleaners: signal */}
      <section id="cleaners" aria-labelledby="cleaners-title" className="scroll-mt-24">
        <div className="mx-auto max-w-[96rem] px-5 py-20 sm:px-10 lg:px-16 lg:py-32">
          <div className="relative grid overflow-hidden rounded-xl bg-teal text-navy lg:grid-cols-12">
            <div className="grid content-between gap-10 p-8 sm:p-12 lg:col-span-7 lg:p-16">
              <div>
                <LogoMark colour="navy" className="size-10" />
                <h2 id="cleaners-title" className="mt-8 text-3xl font-semibold">
                  Clean for Ping. Pick your own work.
                </h2>
              </div>
              <ul className="grid gap-5 text-lg sm:grid-cols-2">
                {[
                  ["Your areas, your hours", "Self-employed, so you choose where and when. Ping never sets your hours."],
                  ["Blocks that stay yours", "Take on a block of up to 8 cleans and every one is yours. When the customer rebooks, you get first refusal."],
                  ["Paid for every clean", "Straight to your bank account once each clean clears. No chasing customers for money."],
                  ["The best get first pick", "Great scores move you up, and Top cleaners see new jobs before anyone else."],
                ].map(([t, b]) => (
                  <li key={t} className="grid gap-1.5 border-t border-navy/20 pt-5">
                    <span className="font-display text-xl font-semibold">{t}</span>
                    <span className="text-navy/80">{b}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                <ButtonLink href={CLEANERS_LINK.href} size="lg" variant="ink">
                  What cleaning for Ping is like
                </ButtonLink>
              </div>
            </div>
            <Photo slot="home-cleaner-portrait" tone="navy" caption="A Ping cleaner, on the way to a regular" className="min-h-[22rem] rounded-none lg:col-span-5 lg:min-h-full" />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ FAQ */}
      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-24 border-t border-line">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-32">
          <div className="lg:sticky lg:top-32 lg:col-span-4 lg:self-start">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-ink">Questions</p>
            <h2 id="faq-title" className="mt-5 text-3xl font-semibold">
              Before you book.
            </h2>
            <p className="mt-6 max-w-sm text-lg text-navy-2">The things people ask most before they let someone new into their home.</p>
            <ButtonLink href={FAQ_LINK.href} variant="secondary" size="lg" className="mt-8">
              Every question, answered
            </ButtonLink>
          </div>
          <div className="lg:col-span-7 lg:col-start-6">
            <FaqList items={FEATURED_FAQ} />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Closing */}
      <section aria-labelledby="close-title" className="px-5 pb-20 sm:px-10 lg:px-16 lg:pb-28">
        <div className="signal-waves relative mx-auto grid max-w-[96rem] gap-10 overflow-hidden rounded-xl p-8 text-on-navy sm:p-12 lg:grid-cols-12 lg:items-end lg:p-20">
          <svg aria-hidden viewBox="0 0 600 600" className="pointer-events-none absolute -right-40 -top-48 size-[36rem] text-on-navy/[0.08] lg:-right-24 lg:-top-56 lg:size-[46rem]">
            {[80, 150, 220, 290].map((r) => (
              <circle key={r} cx="300" cy="300" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
            ))}
            <circle cx="300" cy="300" r="22" className="fill-teal" />
          </svg>
          <h2 id="close-title" className="relative text-4xl font-semibold lg:col-span-8">
            Get your <span className="text-brand-gradient-navy">weekends back.</span>
          </h2>
          <div className="relative grid gap-6 lg:col-span-4">
            <p className="text-lg text-on-navy-2">One cleaner for your whole block, a checklist on every visit, and nothing to pay until each clean is done.</p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/price" size="lg" variant="signal">
                Get your price
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
