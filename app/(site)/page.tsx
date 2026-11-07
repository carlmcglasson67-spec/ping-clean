import Link from "next/link";
import { ButtonLink, PingMark } from "@/components/ui";
import { BeforeAfter } from "./_components/before-after";
import { FaqList } from "./_components/faq-list";
import { Photo } from "./_components/photo";
import { STANDARD_CLEAN, STANDARD_CLEAN_COUNT } from "./_content/checklist";
import { FEATURED_FAQ } from "./_content/faq";
import { AREA_LINKS } from "./_content/nav";

const STATS = [
  { value: "1", label: "cleaner for your home", note: "The same person every visit, not whoever is free." },
  { value: "4", label: "checks before any job", note: "DBS, insurance, photo ID and right to work." },
  { value: String(STANDARD_CLEAN_COUNT), label: "ticks on every clean", note: "A room-by-room checklist, with photos to prove it." },
  { value: "£0", label: "taken before the clean", note: "Your card is charged only once it’s done." },
];

const STEPS = [
  { title: "Get your price", body: "Your postcode and how many hours. One fixed hourly rate, the same in every town, shown before you commit to anything." },
  { title: "Pick your day", body: "Every week, every two weeks or every four weeks, on the day and time window that suits you. Your card is saved, not charged." },
  { title: "Meet your cleaner", body: "Your clean goes first to our highest-rated cleaners near you. One of them takes it on as theirs, and you see who’s coming." },
  { title: "The clean, with proof", body: "They work through the same checklist every visit and take before and after photos, so you can see it’s done even if you’re out." },
  { title: "Pay after, rate it", body: "Your card is charged once the clean is finished. Rate it in a tap. The Ping team checks the photos too." },
];

const PROMISES = [
  { title: "The same cleaner, every visit", body: "Your regular clean is held by one cleaner, so they learn your home and you never explain it twice." },
  { title: "Checked before they start", body: "Every Ping cleaner is DBS checked, insured and has their right to work verified before they see a single job." },
  { title: "Proof on every visit", body: "A room-by-room checklist and before and after photos on every clean, scored by our team." },
  { title: "Pay after, not before", body: "A fixed price agreed up front. Your card is charged only once the clean is finished." },
];

export default function Home() {
  return (
    <>
      {/* ------------------------------------------------------------ Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 pb-16 pt-8 sm:px-10 sm:pt-12 lg:grid-cols-12 lg:gap-10 lg:px-16 lg:pb-28 lg:pt-16">
          <div className="rise flex flex-col lg:col-span-7 lg:pt-10">
            <p className="inline-flex w-fit items-center gap-3 rounded-full bg-card py-2 pl-2 pr-5 text-sm font-semibold ring-1 ring-line">
              <PingMark pulse className="text-signal-ink" />
              Regular cleaning, West Cumbria
            </p>
            <h1 className="mt-10 text-4xl font-semibold lg:mt-14">
              Your regular
              <br />
              clean,{" "}
              <span className="relative inline-block text-signal-ink">
                sorted
                <span className="absolute -right-[0.22em] bottom-[0.18em] size-[0.16em] rounded-full bg-signal" aria-hidden />
              </span>
            </h1>
            <div className="mt-10 grid gap-8 sm:grid-cols-[minmax(0,32rem)_auto] sm:items-end lg:mt-14">
              <p className="text-xl text-ink-2">
                The same vetted, insured cleaner every visit. A proper checklist, photos when they&rsquo;re done, and your card charged only afterwards.
              </p>
            </div>
            <div className="mt-10 flex flex-wrap gap-3">
              <ButtonLink href="/#how" size="lg">
                See how it works
              </ButtonLink>
              <ButtonLink href="/#cleaners" size="lg" variant="secondary">
                I&rsquo;m a cleaner
              </ButtonLink>
            </div>
          </div>

          {/* Image tiles, bleeding off the right edge on large screens. */}
          <div className="rise relative grid grid-cols-6 grid-rows-[repeat(6,minmax(0,1fr))] gap-3 [animation-delay:140ms] sm:gap-4 lg:col-span-5 lg:-mr-16 lg:h-[44rem]">
            <Photo slot="home-hero-kitchen" tone="moss" caption="A kitchen, finished" priority className="col-span-4 row-span-6 min-h-[26rem] lg:min-h-0" />
            <Photo slot="home-hero-cleaner" tone="linen" caption="Your cleaner" className="col-span-2 row-span-3" />
            <Photo slot="home-hero-detail" tone="mist" caption="The detail" className="col-span-2 row-span-3" />

            {/* A moment from the customer app, floating over the photos. */}
            <div className="absolute -bottom-6 left-4 right-10 max-w-[22rem] rounded-lg bg-card p-5 shadow-lift ring-1 ring-line/70 sm:left-8 sm:p-6 lg:-left-14 lg:bottom-14">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-full bg-ok-soft text-ok">
                  <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
                    <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <p className="font-semibold leading-tight">Clean complete</p>
                  <p className="text-sm text-ink-3">Just now</p>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
                <div>
                  <p className="font-display text-2xl font-semibold tabular">
                    {STANDARD_CLEAN_COUNT}/{STANDARD_CLEAN_COUNT}
                  </p>
                  <p className="text-sm text-ink-2">checklist ticked</p>
                </div>
                <div>
                  <p className="font-display text-2xl font-semibold tabular">8</p>
                  <p className="text-sm text-ink-2">photos to look at</p>
                </div>
              </div>
            </div>
          </div>
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
              <dd className="order-1 font-display text-[clamp(4rem,2.5rem+5vw,7.5rem)] font-semibold leading-[0.9] tracking-[-0.04em] text-ink tabular">{s.value}</dd>
              <dd className="order-3 max-w-xs text-base text-ink-2">{s.note}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ------------------------------------------------------------ How it works: before/after + steps */}
      <section id="how" aria-labelledby="how-title" className="scroll-mt-24">
        <div className="mx-auto max-w-[96rem] px-5 py-20 sm:px-10 lg:px-16 lg:py-32">
          <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-signal-ink lg:col-span-12">How it works</p>
            <h2 id="how-title" className="text-3xl font-semibold lg:col-span-7">
              From postcode to a clean home in five steps.
            </h2>
            <p className="text-lg text-ink-2 lg:col-span-4 lg:col-start-9">
              No phone tag, no quotes to chase, no wondering if it got done. Every step happens in the Ping app.
            </p>
          </div>

          <div className="mt-14 grid gap-12 lg:mt-20 lg:grid-cols-12 lg:gap-10">
            <div className="lg:sticky lg:top-32 lg:col-span-6 lg:self-start">
              <BeforeAfter
                label="Drag to compare the room before and after"
                before={<Photo slot="home-before" tone="dusk" caption="Before: the kitchen on a Monday" className="aspect-[4/5] rounded-none" />}
                after={<Photo slot="home-after" tone="mist" caption="After: the same kitchen, two hours later" className="aspect-[4/5] rounded-none" />}
              />
              <p className="mt-4 text-base text-ink-3">Every clean comes with photos like these, in your account.</p>
            </div>

            <ol className="grid content-start lg:col-span-5 lg:col-start-8">
              {STEPS.map((s, i) => (
                <li key={s.title} className="grid grid-cols-[4.5rem_1fr] gap-x-4 border-t border-line py-9 first:border-t-0 first:pt-0 sm:grid-cols-[6rem_1fr]">
                  <span className="font-display text-[3.25rem] font-semibold leading-none text-signal tabular sm:text-[4rem]" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="pt-1">
                    <h3 className="text-xl font-semibold">
                      <span className="sr-only">Step {i + 1}: </span>
                      {s.title}
                    </h3>
                    <p className="mt-3 text-lg text-ink-2">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ What’s included */}
      <section id="included" aria-labelledby="included-title" className="scroll-mt-24 bg-paper-2/70">
        <div className="mx-auto grid max-w-[96rem] gap-14 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:gap-10 lg:px-16 lg:py-32">
          <div className="lg:col-span-4">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-signal-ink">What&rsquo;s included</p>
            <h2 id="included-title" className="mt-5 text-3xl font-semibold">
              The same {STANDARD_CLEAN_COUNT}‑point clean, every visit.
            </h2>
            <p className="mt-6 text-lg text-ink-2">
              Your cleaner ticks each one off in the app as they go. Extras like oven cleans and ironing aren&rsquo;t part of a regular Ping clean yet.
            </p>
            <Photo slot="home-included-bathroom" tone="linen" caption="A bathroom, after" className="mt-10 hidden aspect-[4/3] lg:block" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-8 lg:gap-5">
            {STANDARD_CLEAN.map((r, i) => (
              <article key={r.room} className={"rounded-lg bg-card p-8 shadow-card ring-1 ring-line/70 lg:p-10 " + (i === 0 ? "sm:row-span-1" : "")}>
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="text-xl font-semibold">{r.room}</h3>
                  <span className="whitespace-nowrap text-sm font-semibold text-ink-3 tabular">
                    {r.items.length} {r.items.length === 1 ? "tick" : "ticks"}
                  </span>
                </div>
                <ul className="mt-6 grid gap-4">
                  {r.items.map((item) => (
                    <li key={item} className="grid grid-cols-[1.75rem_1fr] gap-3 text-lg text-ink-2">
                      <span aria-hidden className="mt-1 grid size-6 place-items-center rounded-full bg-ok-soft text-ok">
                        <svg viewBox="0 0 20 20" className="size-3.5">
                          <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Promises: ink */}
      <section id="promises" aria-labelledby="promises-title" className="grain relative scroll-mt-24 overflow-hidden bg-ink text-paper">
        <div className="mx-auto max-w-[96rem] px-5 py-20 sm:px-10 lg:px-16 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-signal">Why Ping</p>
              <h2 id="promises-title" className="mt-5 text-3xl font-semibold">
                Built so the clean is right, every time.
              </h2>
            </div>
            <ol className="grid gap-px overflow-hidden rounded-lg bg-line-dark sm:grid-cols-2 lg:col-span-8">
              {PROMISES.map((p, i) => (
                <li key={p.title} className="grid content-start gap-4 bg-ink p-8 lg:p-12">
                  <span className="font-display text-xl font-semibold text-signal tabular">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="text-2xl font-semibold">{p.title}</h3>
                  <p className="text-lg text-paper/70">{p.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <svg aria-hidden viewBox="0 0 600 600" className="pointer-events-none absolute -bottom-64 -left-48 size-[40rem] text-paper/[0.05]">
          {[90, 170, 250].map((r) => (
            <circle key={r} cx="300" cy="300" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
          ))}
        </svg>
      </section>

      {/* ------------------------------------------------------------ Areas: mist */}
      <section id="areas" aria-labelledby="areas-title" className="scroll-mt-24 bg-mist">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-32">
          <div className="lg:col-span-4">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-ink-2">Where Ping cleans</p>
            <h2 id="areas-title" className="mt-5 text-3xl font-semibold">
              West Cumbria first.
            </h2>
            <p className="mt-6 max-w-sm text-lg text-ink-2">
              Ten towns and the villages between them, from Maryport down the coast to Seascale. Your cleaner lives locally and chooses the areas they cover.
            </p>
          </div>
          <ul className="grid content-start gap-x-10 sm:grid-cols-2 lg:col-span-8">
            {AREA_LINKS.map((t) => (
              <li key={t.label} className="border-b border-ink/15">
                <Link href={t.href} className="group flex min-h-20 items-center justify-between gap-6 py-4">
                  <span className="font-display text-[clamp(1.75rem,1.2rem+1.6vw,2.75rem)] font-semibold leading-none transition-colors group-hover:text-signal-ink">
                    {t.label}
                  </span>
                  <span className="rounded-full bg-paper/70 px-3 py-1 text-sm font-semibold text-ink-2 tabular">{t.districts.join(" ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------ Cleaners: signal */}
      <section id="cleaners" aria-labelledby="cleaners-title" className="scroll-mt-24">
        <div className="mx-auto max-w-[96rem] px-5 py-20 sm:px-10 lg:px-16 lg:py-32">
          <div className="grain relative grid overflow-hidden rounded-xl bg-signal text-ink lg:grid-cols-12">
            <div className="grid content-between gap-10 p-8 sm:p-12 lg:col-span-7 lg:p-16">
              <div>
                <PingMark pulse dot="ink" className="text-ink" />
                <h2 id="cleaners-title" className="mt-8 text-3xl font-semibold">
                  Clean for Ping. Pick your own work.
                </h2>
              </div>
              <ul className="grid gap-5 text-lg sm:grid-cols-2">
                {[
                  ["Your areas, your hours", "Self-employed, so you choose where and when. Ping never sets your hours."],
                  ["Regulars that stay yours", "Take on a home as a regular clean and it stays with you, week after week."],
                  ["Paid for every clean", "Straight to your bank account once each clean clears. No chasing customers for money."],
                  ["The best get first pick", "Great scores move you up, and Top cleaners see new jobs before anyone else."],
                ].map(([t, b]) => (
                  <li key={t} className="grid gap-1.5 border-t border-ink/20 pt-5">
                    <span className="font-display text-xl font-semibold">{t}</span>
                    <span className="text-ink/80">{b}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                <ButtonLink href="/login?next=/work" size="lg" variant="ink">
                  Sign in to apply
                </ButtonLink>
                <p className="max-w-sm text-base font-semibold">New to Ping? Cleaner applications open alongside booking.</p>
              </div>
            </div>
            <Photo slot="home-cleaner-portrait" tone="ink" caption="A Ping cleaner, on the way to a regular" className="min-h-[22rem] rounded-none lg:col-span-5 lg:min-h-full" />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ FAQ */}
      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-24 border-t border-line">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-32">
          <div className="lg:sticky lg:top-32 lg:col-span-4 lg:self-start">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-signal-ink">Questions</p>
            <h2 id="faq-title" className="mt-5 text-3xl font-semibold">
              Before you book.
            </h2>
            <p className="mt-6 max-w-sm text-lg text-ink-2">The things people ask most before they let someone new into their home.</p>
          </div>
          <div className="lg:col-span-7 lg:col-start-6">
            <FaqList items={FEATURED_FAQ} />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Closing */}
      <section aria-labelledby="close-title" className="px-5 pb-20 sm:px-10 lg:px-16 lg:pb-28">
        <div className="grain relative mx-auto grid max-w-[96rem] gap-10 overflow-hidden rounded-xl bg-moss p-8 text-paper sm:p-12 lg:grid-cols-12 lg:items-end lg:p-20">
          <svg aria-hidden viewBox="0 0 600 600" className="pointer-events-none absolute -right-40 -top-48 size-[36rem] text-paper/[0.08] lg:-right-24 lg:-top-56 lg:size-[46rem]">
            {[80, 150, 220, 290].map((r) => (
              <circle key={r} cx="300" cy="300" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
            ))}
            <circle cx="300" cy="300" r="22" className="fill-signal" />
          </svg>
          <h2 id="close-title" className="relative text-4xl font-semibold lg:col-span-8">
            Get your weekends back.
          </h2>
          <div className="relative grid gap-6 lg:col-span-4">
            <p className="text-lg text-paper/80">One cleaner who knows your home, a checklist on every visit, and nothing to pay until it&rsquo;s done.</p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/#how" size="lg">
                See how it works
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
