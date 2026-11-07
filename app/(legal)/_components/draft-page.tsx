import type { ReactNode } from "react";
import { Wordmark } from "@/components/ui";

/**
 * Placeholder legal page. The headings say what the final page must cover; the wording is
 * Carl's and Kate's to write. Clearly marked as a draft so nobody mistakes it for the real thing.
 */
export function DraftLegalPage({ title, intro, sections }: { title: string; intro: ReactNode; sections: { heading: string; points: string[] }[] }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex max-w-[96rem] items-center px-5 py-6 sm:px-10 lg:px-16">
        <Wordmark />
      </header>
      <section className="signal-waves">
        <div className="mx-auto grid max-w-[96rem] gap-8 px-5 py-16 text-on-navy sm:px-10 lg:grid-cols-12 lg:px-16 lg:py-24">
          <div className="lg:col-span-7">
            <p className="mb-6 inline-flex items-center gap-3 rounded-full bg-warn-soft px-4 py-1.5 text-sm font-bold uppercase tracking-[0.12em] text-warn">
              Draft for Carl and Kate to finalise
            </p>
            <h1 className="text-3xl font-semibold">{title}</h1>
          </div>
          <p className="self-end text-lg text-on-navy-2 lg:col-span-5">{intro}</p>
        </div>
      </section>
      <main className="mx-auto grid max-w-[96rem] gap-6 px-5 py-16 sm:px-10 lg:grid-cols-2 lg:px-16 lg:py-24">
        {sections.map((s, i) => (
          <section key={s.heading} className="rounded-lg bg-card p-7 shadow-card ring-1 ring-line/70 sm:p-9">
            <p className="font-display text-sm font-semibold text-teal-ink">{String(i + 1).padStart(2, "0")}</p>
            <h2 className="mt-2 text-xl font-semibold">{s.heading}</h2>
            <ul className="mt-4 grid gap-2 text-navy-2">
              {s.points.map((p) => (
                <li key={p} className="flex gap-3">
                  <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-teal-deep" />
                  {p}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
