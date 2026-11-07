import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink, PingMark } from "@/components/ui";
import { ChecklistGrid, Crumbs, Eyebrow, Rings, StepList } from "../../_components/blocks";
import { FaqList } from "../../_components/faq-list";
import { Photo } from "../../_components/photo";
import { STANDARD_CLEAN_COUNT } from "../../_content/checklist";
import type { Faq } from "../../_content/faq";
import { STEPS } from "../../_content/how";
import { CLEANERS_LINK, FAQ_LINK, areaHref } from "../../_content/nav";
import { TOWNS, townBySlug, type Town } from "../../_content/towns";

export const dynamicParams = false;

export function generateStaticParams() {
  return TOWNS.map((t) => ({ town: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ town: string }> }): Promise<Metadata> {
  const town = townBySlug((await params).town);
  if (!town) return {};
  return {
    title: `Regular cleaning in ${town.name}`,
    description: `A vetted, insured cleaner every visit in ${town.name} and around ${town.around.slice(0, 3).join(", ")}. Fixed hourly price, a checklist and photos on every clean, and you pay only once it’s done.`,
    alternates: { canonical: areaHref(town.slug) },
  };
}

function localFaq(t: Town): Faq[] {
  const places = t.around.length > 1 ? `${t.around.slice(0, -1).join(", ")} and ${t.around.at(-1)}` : t.around[0];
  return [
    {
      q: `Do you cover ${places}?`,
      a: `Ping cleaners choose the postcode districts they travel to, and ${t.districts.join(" and ")} is the district for ${t.name}. Put your postcode into the instant price and you’ll see straight away whether we’re booking where you live.`,
    },
    {
      q: `Will I get the same cleaner in ${t.name} every time?`,
      a: "Yes. Your regular clean is taken on by one cleaner as a whole arrangement, not visit by visit, so the same person comes each time and gets to know your home.",
    },
    {
      q: "Is the price different here?",
      a: `No. Ping has one fixed hourly rate, the same in ${t.name} as everywhere else, set by Ping rather than haggled with a cleaner. You see the exact price per clean before you book.`,
    },
    {
      q: "When do I pay?",
      a: "Your card is saved securely when you book and charged only after each clean is finished. Nothing is taken in advance.",
    },
  ];
}

export default async function AreaPage({ params }: { params: Promise<{ town: string }> }) {
  const town = townBySlug((await params).town);
  if (!town) notFound();
  const near = town.near.map(townBySlug).filter((t): t is Town => Boolean(t));

  return (
    <>
      {/* ------------------------------------------------------------ Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 pb-16 pt-4 sm:px-10 lg:grid-cols-12 lg:gap-10 lg:px-16 lg:pb-24 lg:pt-8">
          <div className="rise flex flex-col lg:col-span-7">
            <Crumbs items={[{ href: "/", label: "Home" }, { href: "/areas", label: "Areas" }, { label: town.name }]} />
            <p className="mt-10 inline-flex w-fit items-center gap-3 rounded-full bg-card py-2 pl-2 pr-5 text-sm font-semibold ring-1 ring-line lg:mt-14">
              <PingMark pulse className="text-signal-ink" />
              {town.line}
            </p>
            <h1 className="mt-8 text-4xl font-semibold">
              Regular cleaning in <span className="text-signal-ink">{town.name}</span>
            </h1>
            <p className="mt-10 max-w-2xl text-xl text-ink-2">{town.intro}</p>
            <div className="mt-10 flex flex-wrap gap-3">
              <ButtonLink href="/price" size="lg">
                Get your price
              </ButtonLink>
              <ButtonLink href={FAQ_LINK.href} size="lg" variant="secondary">
                Questions
              </ButtonLink>
            </div>
          </div>

          <div className="rise relative grid min-h-[26rem] grid-cols-5 gap-3 [animation-delay:140ms] sm:gap-4 lg:col-span-5 lg:-mr-16 lg:min-h-[40rem]">
            <Photo slot={`area-${town.slug}-street`} tone="dusk" caption={`A street in ${town.name}`} priority className="col-span-3" />
            <div className="col-span-2 grid gap-3 sm:gap-4">
              <Photo slot={`area-${town.slug}-home`} tone="linen" caption="A home, after" />
              <div className="grain grid content-between rounded-lg bg-ink p-5 text-paper sm:p-6">
                <span className="text-sm font-semibold uppercase tracking-[0.16em] text-signal">Postcode</span>
                <span className="font-display text-[clamp(2.5rem,1.5rem+3vw,4.5rem)] font-semibold leading-none tracking-[-0.04em]">
                  {town.districts.join(" ")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Around the town */}
      <section aria-labelledby="around-title" className="bg-mist">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-28">
          <div className="lg:col-span-4">
            <Eyebrow tone="muted">Around {town.name}</Eyebrow>
            <h2 id="around-title" className="mt-5 text-3xl font-semibold">
              Cleaners who choose to work here.
            </h2>
            <p className="mt-6 max-w-sm text-lg text-ink-2">
              Ping cleaners pick the postcode districts they travel to, so whoever takes on your home has chosen to cover it.
            </p>
          </div>
          <ul className="flex flex-wrap content-start gap-x-8 gap-y-3 lg:col-span-8">
            {[town.name, ...town.around].map((p, i) => (
              <li key={p} className="font-display text-[clamp(1.875rem,1.3rem+2vw,3.25rem)] font-semibold leading-tight">
                <span className={i === 0 ? "text-signal-ink" : "text-ink"}>{p}</span>
                {i < town.around.length ? (
                  <span className="ml-8 text-signal" aria-hidden>
                    ·
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------ What's included */}
      <section aria-labelledby="included-title" className="bg-paper-2/70">
        <div className="mx-auto grid max-w-[96rem] gap-14 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:gap-10 lg:px-16 lg:py-28">
          <div className="lg:col-span-4">
            <Eyebrow>Every clean in {town.name}</Eyebrow>
            <h2 id="included-title" className="mt-5 text-3xl font-semibold">
              The same {STANDARD_CLEAN_COUNT}&#8209;point checklist.
            </h2>
            <p className="mt-6 text-lg text-ink-2">
              Ticked off in the app as your cleaner goes, with before and after photos you can see from wherever you are.
            </p>
          </div>
          <ChecklistGrid className="lg:col-span-8" />
        </div>
      </section>

      {/* ------------------------------------------------------------ How it works: ink */}
      <section aria-labelledby="how-title" className="grain relative overflow-hidden bg-ink text-paper">
        <div className="mx-auto grid max-w-[96rem] gap-14 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:gap-10 lg:px-16 lg:py-28">
          <div className="lg:col-span-5">
            <Eyebrow tone="onInk">How it works</Eyebrow>
            <h2 id="how-title" className="mt-5 text-3xl font-semibold">
              Book once. Same cleaner every visit.
            </h2>
          </div>
          <div className="lg:col-span-6 lg:col-start-7">
            <StepList steps={STEPS} tone="ink" />
          </div>
        </div>
        <Rings className="-bottom-72 -left-56 size-[44rem] text-paper/[0.05]" />
      </section>

      {/* ------------------------------------------------------------ Local questions */}
      <section aria-labelledby="faq-title">
        <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-28">
          <div className="lg:col-span-4">
            <Eyebrow>Questions from {town.name}</Eyebrow>
            <h2 id="faq-title" className="mt-5 text-3xl font-semibold">
              Good to know.
            </h2>
            <ButtonLink href={FAQ_LINK.href} variant="secondary" size="lg" className="mt-8">
              Every question, answered
            </ButtonLink>
          </div>
          <div className="lg:col-span-7 lg:col-start-6">
            <FaqList items={localFaq(town)} />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Nearby + cleaners */}
      <section aria-label="Nearby and cleaners" className="px-5 pb-20 sm:px-10 lg:px-16 lg:pb-28">
        <div className="mx-auto grid max-w-[96rem] gap-4 lg:grid-cols-12 lg:gap-5">
          <div className="min-w-0 rounded-xl bg-card p-8 shadow-card ring-1 ring-line/70 sm:p-12 lg:col-span-7">
            <Eyebrow tone="muted">Nearby</Eyebrow>
            <ul className="mt-6 grid">
              {near.map((t) => (
                <li key={t.slug} className="border-b border-line last:border-b-0">
                  <Link href={areaHref(t.slug)} className="group flex min-h-20 items-center justify-between gap-6 py-4">
                    <span className="min-w-0 font-display text-[clamp(1.75rem,1.2rem+1.6vw,2.75rem)] font-semibold leading-none group-hover:text-signal-ink">{t.name}</span>
                    <span className="flex shrink-0 items-center gap-3 sm:gap-4">
                      <span className="rounded-full bg-paper-2 px-3 py-1 text-sm font-semibold text-ink-2 tabular">{t.districts.join(" ")}</span>
                      <span aria-hidden className="text-2xl transition-transform group-hover:translate-x-1">
                        &rarr;
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="grain relative grid content-between gap-10 overflow-hidden rounded-xl bg-signal p-8 text-ink sm:p-12 lg:col-span-5">
            <PingMark pulse dot="ink" className="text-ink" />
            <div>
              <h2 className="text-2xl font-semibold">Clean in {town.name}? Clean for Ping.</h2>
              <p className="mt-4 text-lg text-ink/85">Self-employed, your own areas and hours, regular homes that stay with you.</p>
              <ButtonLink href={CLEANERS_LINK.href} variant="ink" size="lg" className="mt-8">
                Find out more
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
