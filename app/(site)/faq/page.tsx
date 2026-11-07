import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { Crumbs, Eyebrow, Rings } from "../_components/blocks";
import { FaqList } from "../_components/faq-list";
import { FAQ } from "../_content/faq";
import { CLEANERS_LINK } from "../_content/nav";

export const metadata: Metadata = {
  title: "Questions",
  description: "How Ping prices, books and checks every regular clean in West Cumbria: your cleaner, access, what’s included, paying, skipping and cancelling.",
  alternates: { canonical: "/faq" },
};

// FAQPage structured data, built from the same content the page shows.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.flatMap((g) => g.items).map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function FaqPage() {
  const count = FAQ.reduce((n, g) => n + g.items.length, 0);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      <section className="grain relative overflow-hidden bg-ink text-paper">
        <div className="mx-auto grid max-w-[96rem] gap-10 px-5 pb-20 pt-6 sm:px-10 lg:grid-cols-12 lg:px-16 lg:pb-28 lg:pt-10">
          <div className="lg:col-span-8 [&_a]:text-paper/60 [&_a:hover]:text-paper [&_[aria-current]]:text-paper">
            <Crumbs items={[{ href: "/", label: "Home" }, { label: "Questions" }]} />
            <h1 className="mt-10 text-4xl font-semibold lg:mt-14">
              Asked, <span className="text-signal">answered.</span>
            </h1>
          </div>
          <div className="grid content-end gap-2 lg:col-span-4">
            <span className="font-display text-[clamp(4rem,2.5rem+5vw,7.5rem)] font-semibold leading-[0.9] tracking-[-0.04em] tabular">{count}</span>
            <span className="text-lg text-paper/70">questions people ask before they let someone new into their home.</span>
          </div>
        </div>
        <Rings className="-right-64 -top-72 size-[48rem] text-paper/[0.06]" />
      </section>

      <section aria-label="All questions">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-28">
          <nav aria-label="Topics" className="lg:sticky lg:top-32 lg:col-span-3 lg:self-start">
            <Eyebrow tone="muted">Topics</Eyebrow>
            <ol className="mt-5 flex flex-wrap gap-2 lg:grid lg:gap-1">
              {FAQ.map((g, i) => (
                <li key={g.id}>
                  <a
                    href={`#${g.id}`}
                    className="flex min-h-12 items-center gap-3 rounded-full bg-card px-5 text-base font-semibold ring-1 ring-line hover:ring-ink-3 lg:rounded-md lg:bg-transparent lg:px-3 lg:ring-0 lg:hover:bg-card"
                  >
                    <span className="font-display text-signal-ink tabular">{String(i + 1).padStart(2, "0")}</span>
                    {g.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="grid gap-20 lg:col-span-8 lg:col-start-5">
            {FAQ.map((g, i) => (
              <section key={g.id} id={g.id} aria-labelledby={`${g.id}-title`} className="scroll-mt-28">
                <div className="mb-6 flex items-baseline gap-5">
                  <span className="font-display text-[3rem] font-semibold leading-none text-signal tabular" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h2 id={`${g.id}-title`} className="text-2xl font-semibold">
                    {g.title}
                  </h2>
                </div>
                <FaqList items={g.items} />
              </section>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="cleaner-q-title" className="px-5 pb-20 sm:px-10 lg:px-16 lg:pb-28">
        <div className="grain mx-auto grid max-w-[96rem] gap-8 rounded-xl bg-mist p-8 sm:p-12 lg:grid-cols-12 lg:items-end lg:p-16">
          <h2 id="cleaner-q-title" className="text-3xl font-semibold lg:col-span-7">
            A cleaner with questions about Ping?
          </h2>
          <div className="lg:col-span-4 lg:col-start-9">
            <p className="text-lg text-ink-2">Finding work, moving up the tiers and getting paid, all on one page.</p>
            <ButtonLink href={CLEANERS_LINK.href} variant="ink" size="lg" className="mt-6">
              Clean for Ping
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
