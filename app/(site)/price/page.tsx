import type { Metadata } from "next";
import { ChecklistGrid, Crumbs, Eyebrow } from "../_components/blocks";
import { FaqList } from "../_components/faq-list";
import { InstantPrice } from "../_components/instant-price";
import { STANDARD_CLEAN_COUNT } from "../_content/checklist";
import { FAQ } from "../_content/faq";
import { getPricing } from "../_lib/pricing";

export const metadata: Metadata = {
  title: "Get your price",
  description: "Your postcode and how many hours: the exact price of a regular clean in West Cumbria, before you commit to anything.",
  alternates: { canonical: "/price" },
};

// Prices come from the settings table on every request, so a change in the admin
// console shows here straight away.
export const dynamic = "force-dynamic";

const HOW_PRICED = [
  { title: "One hourly rate", body: "The same in every town, set by Ping. Cleaners can’t change it and nobody haggles on the doorstep." },
  { title: "A minimum booking", body: "So every visit is long enough to do the whole checklist properly, not a rushed half job." },
  { title: "Charged after", body: "Your card is saved when you book and charged only once each clean is marked finished." },
];

export default async function PricePage() {
  const pricing = await getPricing();
  const priceFaq = FAQ.find((g) => g.id === "booking")?.items ?? [];

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-[96rem] px-5 pb-16 pt-4 sm:px-10 lg:px-16 lg:pb-24 lg:pt-8">
          <Crumbs items={[{ href: "/", label: "Home" }, { label: "Get your price" }]} />
          <div className="mt-10 grid gap-8 lg:mt-14 lg:grid-cols-12 lg:items-end">
            <h1 className="rise text-4xl font-semibold lg:col-span-8">
              Your price,
              <br />
              <span className="text-teal-ink">in ten seconds.</span>
            </h1>
            <p className="rise text-xl text-navy-2 [animation-delay:120ms] lg:col-span-4 lg:pb-3">
              {pricing.status === "open"
                ? "Your postcode and how long you’d like. No forms, no call back, no sign-up to see it."
                : "When booking opens, this is where you’ll see it: no forms, no call back, no sign-up. Here’s how it will work."}
            </p>
          </div>
          <div className="rise mt-12 [animation-delay:200ms] lg:mt-16">
            <InstantPrice pricing={pricing} />
          </div>
        </div>
      </section>

      <section aria-labelledby="priced-title" className="bg-mist">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-28">
          <div className="lg:col-span-4">
            <Eyebrow tone="muted">How it&rsquo;s priced</Eyebrow>
            <h2 id="priced-title" className="mt-5 text-3xl font-semibold">
              Simple on purpose.
            </h2>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-lg bg-navy/10 sm:grid-cols-3 lg:col-span-8">
            {HOW_PRICED.map((h, i) => (
              <li key={h.title} className="grid content-start gap-4 bg-canvas/70 p-8 lg:p-10">
                <span className="font-display text-xl font-semibold text-teal-ink tabular">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-2xl font-semibold">{h.title}</h3>
                <p className="text-lg text-navy-2">{h.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="included-title" className="bg-mist/70">
        <div className="mx-auto grid max-w-[96rem] gap-14 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:gap-10 lg:px-16 lg:py-28">
          <div className="lg:col-span-4">
            <Eyebrow>What you&rsquo;re paying for</Eyebrow>
            <h2 id="included-title" className="mt-5 text-3xl font-semibold">
              The {STANDARD_CLEAN_COUNT}&#8209;point clean, every visit.
            </h2>
          </div>
          <ChecklistGrid className="lg:col-span-8" />
        </div>
      </section>

      <section aria-labelledby="pfaq-title">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-28">
          <div className="lg:col-span-4">
            <Eyebrow>Questions</Eyebrow>
            <h2 id="pfaq-title" className="mt-5 text-3xl font-semibold">
              About price and booking.
            </h2>
          </div>
          <div className="lg:col-span-7 lg:col-start-6">
            <FaqList items={priceFaq} />
          </div>
        </div>
      </section>
    </>
  );
}
