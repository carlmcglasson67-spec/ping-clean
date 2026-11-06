import Link from "next/link";
import { ButtonLink, PingMark, Wordmark } from "@/components/ui";

// Pre-launch holding page. The full Lakeland-depth site (mega-menu, area pages,
// instant price, booking) is Track A in intent/v1/plan.md and replaces this.

const PROMISES = [
  {
    n: "01",
    title: "The same cleaner, every week",
    body: "Your regular clean is held by one cleaner, so they learn your home and you never have to explain it twice.",
  },
  {
    n: "02",
    title: "Checked before they start",
    body: "Every Ping cleaner is DBS checked, insured and has their right to work verified before they see a single job.",
  },
  {
    n: "03",
    title: "Proof on every visit",
    body: "A room-by-room checklist and before-and-after photos on every clean, scored by our team.",
  },
  {
    n: "04",
    title: "Pay after, not before",
    body: "A fixed price agreed upfront. Your card is charged only once the clean is finished.",
  },
];

const TOWNS = ["Workington", "Whitehaven", "Cockermouth", "Maryport", "Egremont", "Cleator Moor", "Seascale", "Distington"];

export default function Home() {
  return (
    <div className="bg-paper">
      <header className="mx-auto flex max-w-[96rem] items-center gap-6 px-5 py-6 sm:px-10 lg:px-16">
        <Wordmark />
        <nav aria-label="Main" className="ml-auto flex items-center gap-2 sm:gap-6">
          <a href="#how" className="hidden min-h-12 items-center text-base font-semibold text-ink-2 hover:text-ink sm:inline-flex">
            How it works
          </a>
          <a href="#cleaners" className="hidden min-h-12 items-center text-base font-semibold text-ink-2 hover:text-ink sm:inline-flex">
            Clean for Ping
          </a>
          <ButtonLink href="/login" variant="secondary">
            Sign in
          </ButtonLink>
        </nav>
      </header>

      {/* Hero: asymmetric, full-bleed, no centred column. */}
      <section className="mx-auto grid max-w-[96rem] gap-10 px-5 pb-20 pt-10 sm:px-10 sm:pt-16 lg:grid-cols-12 lg:gap-8 lg:px-16 lg:pb-28 lg:pt-24">
        <div className="rise lg:col-span-8">
          <p className="mb-8 inline-flex items-center gap-3 rounded-full bg-card py-2 pl-2 pr-5 text-sm font-semibold ring-1 ring-line">
            <span className="whitespace-nowrap rounded-full bg-ink px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-paper">Coming soon</span>
            Regular home cleaning in West Cumbria
          </p>
          <h1 className="text-4xl font-semibold">
            Your regular
            <br />
            clean, <span className="relative inline-block text-signal-ink">sorted<span className="absolute -right-[0.22em] bottom-[0.18em] size-[0.16em] rounded-full bg-signal" aria-hidden /></span>
          </h1>
        </div>
        <div className="rise grid content-end gap-8 [animation-delay:120ms] lg:col-span-4 lg:pb-4">
          <p className="text-xl text-ink-2">
            Book once. The same vetted, insured cleaner arrives every week, follows a proper checklist, and sends photos when they&rsquo;re done.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="#how" size="lg">See how it works</ButtonLink>
            <ButtonLink href="#cleaners" size="lg" variant="ghost">
              I&rsquo;m a cleaner
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* The four promises: ink panel, numbered, carries the eye. */}
      <section id="how" aria-labelledby="how-title" className="grain relative overflow-hidden bg-ink text-paper">
        <div className="mx-auto max-w-[96rem] px-5 py-20 sm:px-10 lg:px-16 lg:py-32">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-signal">How Ping is different</p>
              <h2 id="how-title" className="mt-5 text-3xl font-semibold">
                Built so the clean is right, every time.
              </h2>
            </div>
            <ol className="grid gap-px overflow-hidden rounded-lg bg-line-dark sm:grid-cols-2 lg:col-span-8">
              {PROMISES.map((p) => (
                <li key={p.n} className="grid content-start gap-4 bg-ink p-8 lg:p-10">
                  <span className="font-display text-xl font-semibold text-signal tabular">{p.n}</span>
                  <h3 className="text-xl font-semibold">{p.title}</h3>
                  <p className="text-paper/70">{p.body}</p>
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

      {/* Where: towns as a typographic band on mist. */}
      <section aria-labelledby="where-title" className="bg-mist">
        <div className="mx-auto grid max-w-[96rem] gap-10 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-28">
          <div className="lg:col-span-4">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-ink-2">Where we&rsquo;re starting</p>
            <h2 id="where-title" className="mt-5 text-2xl font-semibold">West Cumbria first.</h2>
            <p className="mt-4 max-w-sm text-lg text-ink-2">From the team behind Cumbria Bright, cleaning homes across the west coast for years.</p>
          </div>
          <ul className="flex flex-wrap content-start gap-x-6 gap-y-3 lg:col-span-8">
            {TOWNS.map((t, i) => (
              <li key={t} className="font-display text-3xl font-semibold text-ink">
                {t}
                {i < TOWNS.length - 1 ? <span className="ml-6 text-signal" aria-hidden>·</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Cleaners: signal panel. */}
      <section id="cleaners" aria-labelledby="cleaners-title" className="mx-auto max-w-[96rem] px-5 py-20 sm:px-10 lg:px-16 lg:py-28">
        <div className="grain relative grid gap-10 overflow-hidden rounded-xl bg-signal p-8 text-ink sm:p-12 lg:grid-cols-12 lg:p-16">
          <div className="lg:col-span-7">
            <PingMark pulse dot="ink" className="text-ink" />
            <h2 id="cleaners-title" className="mt-6 text-3xl font-semibold">
              Clean for Ping. Pick your own work.
            </h2>
          </div>
          <div className="grid content-end gap-6 lg:col-span-5">
            <p className="text-lg text-ink/85">
              Self-employed, your areas, your hours. Regular homes that stay with you, paid straight to your account after every clean. The best cleaners get first pick of new jobs.
            </p>
            <p className="text-base font-semibold">Applications open alongside booking. Already clean for Cumbria Bright? Speak to the office.</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[96rem] flex-wrap items-center gap-6 px-5 py-10 text-sm text-ink-3 sm:px-10 lg:px-16">
          <Wordmark />
          <span>Regular home cleaning in West Cumbria.</span>
          <Link href="/login" className="ml-auto inline-flex min-h-12 items-center font-semibold text-ink hover:text-signal-ink">
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
