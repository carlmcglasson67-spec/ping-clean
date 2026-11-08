import type { Metadata } from "next";
import Link from "next/link";
import { Crumbs, Eyebrow, Rings } from "../_components/blocks";
import { Photo } from "../_components/photo";
import { areaHref } from "../_content/nav";
import { TOWNS } from "../_content/towns";

export const metadata: Metadata = {
  title: "Areas we clean",
  description:
    "Regular home cleaning across West Cumbria: Workington, Whitehaven, Cockermouth, Maryport, Egremont, Cleator Moor, Frizington, St Bees, Seascale and Distington.",
  alternates: { canonical: "/areas" },
};

const TONES = ["navy", "steel", "cloud", "deep", "mist"] as const;

export default function AreasPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-[96rem] gap-10 px-5 pb-16 pt-4 sm:px-10 lg:grid-cols-12 lg:px-16 lg:pb-24 lg:pt-8">
          <div className="rise lg:col-span-8">
            <Crumbs items={[{ href: "/", label: "Home" }, { label: "Areas" }]} />
            <h1 className="mt-10 text-4xl font-semibold lg:mt-14">
              West Cumbria,
              <br />
              <span className="text-teal-ink">town by town.</span>
            </h1>
          </div>
          <div className="rise grid content-end gap-6 [animation-delay:120ms] lg:col-span-4 lg:pb-4">
            <p className="text-xl text-navy-2">
              Ten towns and the villages between them, from Maryport down the coast to Seascale. Pick yours to see what a regular clean looks like there.
            </p>
          </div>
        </div>
      </section>

      <section aria-label="Towns" className="px-5 pb-20 sm:px-10 lg:px-16 lg:pb-28">
        <ul className="mx-auto grid max-w-[96rem] gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:gap-5">
          {TOWNS.map((t, i) => {
            // Editorial rhythm: two wide cards, then three narrow, repeating.
            const wide = i % 5 < 2;
            return (
              <li key={t.slug} className={wide ? "lg:col-span-3" : "lg:col-span-2"}>
                <Link href={areaHref(t.slug)} className="group block h-full">
                  <Photo
                    slot={`area-${t.slug}-street`}
                    tone={TONES[i % TONES.length]}
                    caption={t.around.slice(0, 3).join(" · ")}
                    className={wide ? "aspect-[16/10]" : "aspect-[4/5]"}
                  >
                    <div className="absolute inset-x-5 top-5 flex items-start justify-between gap-4 sm:inset-x-7 sm:top-7">
                      <span className="font-display text-[clamp(2rem,1.4rem+2vw,3.5rem)] font-semibold leading-none tracking-[-0.035em] drop-shadow-sm transition-transform duration-500 group-hover:translate-x-1">
                        {t.name}
                      </span>
                      <span className="rounded-full bg-canvas/90 px-3 py-1 text-sm font-semibold text-navy tabular">{t.districts.join(" ")}</span>
                    </div>
                  </Photo>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="not-listed-title" className="relative overflow-hidden signal-waves text-on-navy">
        <div className="mx-auto grid max-w-[96rem] gap-10 px-5 py-20 sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-28">
          <div className="lg:col-span-6">
            <Eyebrow tone="onInk">Not on the list?</Eyebrow>
            <h2 id="not-listed-title" className="mt-5 text-3xl font-semibold">
              Ping grows where cleaners are.
            </h2>
          </div>
          <p className="text-lg text-on-navy-2 lg:col-span-5 lg:col-start-8 lg:self-end">
            We open a postcode when there are enough vetted local cleaners to look after it properly. If you live just outside these towns, check your postcode when booking opens: you may well be covered already.
          </p>
        </div>
        <Rings className="-right-56 -top-64 size-[44rem] text-on-navy/[0.06]" dot />
      </section>
    </>
  );
}
