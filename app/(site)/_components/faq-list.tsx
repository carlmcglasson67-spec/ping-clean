import type { Faq } from "../_content/faq";

/** Questions as native disclosure widgets: keyboard and screen reader friendly, no JS. */
export function FaqList({ items, tone = "paper" }: { items: Faq[]; tone?: "paper" | "card" }) {
  return (
    <div className="border-t border-line">
      {items.map((f) => (
        <details key={f.q} className="group border-b border-line">
          <summary
            className={
              "flex min-h-20 cursor-pointer list-none items-center justify-between gap-6 py-6 font-display text-xl font-semibold transition-colors hover:text-teal-ink [&::-webkit-details-marker]:hidden " +
              (tone === "card" ? "px-6 sm:px-8" : "")
            }
          >
            {f.q}
            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-card ring-1 ring-line transition-transform duration-300 group-open:rotate-45 group-open:bg-teal group-open:ring-teal">
              <svg viewBox="0 0 16 16" className="size-4">
                <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
          </summary>
          <p className={"max-w-3xl pb-8 pr-14 text-lg text-navy-2 " + (tone === "card" ? "px-6 sm:px-8" : "")}>{f.a}</p>
        </details>
      ))}
    </div>
  );
}
