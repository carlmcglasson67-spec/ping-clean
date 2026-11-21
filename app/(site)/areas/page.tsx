import type { Metadata } from "next";
import Link from "next/link";
import { Crumbs, Eyebrow, Rings } from "../_components/blocks";
import { Photo } from "../_components/photo";
import { areaHref, townCount } from "../_content/nav";
import { REGIONS, TOWNS, townsIn } from "../_content/towns";

export const metadata: Metadata = {
  title: "Areas we clean",
  description:
    `Regular home cleaning in Carlisle and West Cumbria: ${TOWNS.map((t) => t.name).join(", ")}.`,
  alternates: { canonical: "/areas" },
};

const TONES = ["navy", "steel", "cloud", "deep", "mist"] as const;

/**
 * Two wide cards (3 of 6 columns), then three narrow (2 of 6), repeating. The last card
 * stretches to close its row, so a region with an odd count never ends on a gap.
 */
function cardSpan(i: number, count: number): string {
  const last = i === count - 1;
  const left = count % 5;
  const sm = last && count % 2 === 1 ? "sm:col-span-2 " : "";
  if (last && (left === 1 || left === 3)) return sm + "lg:col-span-6";
  if (last && left === 4) return sm + "lg:col-span-4";
  return sm + (i % 5 < 2 ? "lg:col-span-3" : "lg:col-span-2");
}

export default function AreasPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-[96rem] gap-10 px-5 pb-16 pt-4 sm:px-10 lg:grid-cols-12 lg:px-16 lg:pb-24 lg:pt-8">
          <div className="rise lg:col-span-8">
            <Crumbs items={[{ href: "/", label: "Home" }, { label: "Areas" }]} />
            <h1 className="mt-10 text-4xl font-semibold lg:mt-14">
              Carlisle and West Cumbria,
              <br />
              <span className="text-teal-ink">town by town.</span>
            </h1>
          </div>
          <div className="rise grid content-end gap-6 [animation-delay:120ms] lg:col-span-4 lg:pb-4">
            <p className="text-xl text-navy-2">
              {townCount()} and the villages between them: Carlisle and out to Wigton, Longtown and Brampton, then the west coast from Maryport to Seascale. Pick yours to see what a regular clean looks like there.
            </p>
          </div>
        </div>
      </section>

      {REGIONS.map((r, ri) => (
        <section key={r.id} aria-labelledby={`region-${r.id}`} className={"px-5 sm:px-10 lg:px-16 " + (ri === REGIONS.length - 1 ? "pb-20 lg:pb-28" : "pb-16 lg:pb-24")}>
          <div className="mx-auto mb-8 grid max-w-[96rem] gap-3 border-t border-line pt-8 lg:mb-10 lg:grid-cols-12 lg:items-end lg:gap-x-10 lg:pt-10">
            <h2 id={`region-${r.id}`} className="text-2xl font-semibold lg:col-span-7">
              <span className="mr-4 font-display text-lg text-teal-ink tabular">{String(ri + 1).padStart(2, "0")}</span>
              {r.name}
            </h2>
            <p className="text-lg text-navy-2 lg:col-span-5 lg:text-right">{r.line}</p>
          </div>
          <ul className="mx-auto grid max-w-[96rem] gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:gap-5">
            {townsIn(r.id).map((t, i, all) => {
              // Editorial rhythm: two wide cards, then three narrow, repeating.
              const wide = i % 5 < 2;
              const full = cardSpan(i, all.length).includes("lg:col-span-6");
              return (
                <li key={t.slug} className={cardSpan(i, all.length)}>
                  <Link href={areaHref(t.slug)} className="group block h-full">
                    <Photo
                      slot={`area-${t.slug}-street`}
                      tone={TONES[i % TONES.length]}
                      caption={t.around.slice(0, 3).join(" · ")}
                      className={full ? "aspect-[16/10] lg:aspect-[32/9]" : wide ? "aspect-[16/10]" : "aspect-[4/5]"}
                    >
                      <div className="absolute inset-x-5 top-5 flex items-start justify-between gap-4 sm:inset-x-7 sm:top-7">
                        <span className="min-w-0 font-display text-[clamp(2rem,1.4rem+2vw,3.5rem)] font-semibold leading-none tracking-[-0.035em] drop-shadow-sm transition-transform duration-500 group-hover:translate-x-1">
                          {t.name}
                        </span>
                        <span className="shrink-0 rounded-full bg-canvas/90 px-3 py-1 text-sm font-semibold text-navy tabular">{t.districts.join(" ")}</span>
                      </div>
                    </Photo>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

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
