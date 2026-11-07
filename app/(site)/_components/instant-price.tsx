"use client";

import type { Route } from "next";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { ButtonLink, cn } from "@/components/ui";
import { formatDuration, formatPence, formatPenceShort } from "@/lib/money";
import { parsePostcode } from "../_lib/postcode";
import type { PricingState } from "../_lib/pricing-shape";
import { clampMinutes, MAX_MINUTES, quotePence, STEP_MINUTES } from "../_lib/quote";

type Open = Extract<PricingState, { status: "open" }>;

/**
 * Instant price: postcode + hours → the price of one clean.
 *
 * Everything here is display. The postcode never leaves the browser, and checkout
 * recalculates the price on the server from the settings table before anything is saved.
 */
export function InstantPrice({ pricing, tone = "card" }: { pricing: PricingState; tone?: "card" | "ink" }) {
  if (pricing.status === "open") return <OpenPrice pricing={pricing} tone={tone} />;
  return <NotOpen status={pricing.status} tone={tone} />;
}

function OpenPrice({ pricing, tone }: { pricing: Open; tone: "card" | "ink" }) {
  const ids = { postcode: useId(), hint: useId(), hours: useId(), result: useId() };
  const [raw, setRaw] = useState("");
  const [touched, setTouched] = useState(false);
  const [minutes, setMinutes] = useState(pricing.minBookingMinutes);

  const parsed = parsePostcode(raw);
  const covered = (parsed.kind === "full" || parsed.kind === "district") && pricing.launchDistricts.includes(parsed.district);
  const price = quotePence(pricing.pricePerHourPence, minutes);
  const showInvalid = touched && parsed.kind === "invalid";
  const atMin = minutes <= pricing.minBookingMinutes;
  const atMax = minutes >= MAX_MINUTES;
  const step = (d: number) => setMinutes((m) => clampMinutes(m + d * STEP_MINUTES, pricing.minBookingMinutes));

  return (
    <div className={cn("grid overflow-hidden rounded-xl lg:grid-cols-2", tone === "ink" ? "ring-1 ring-line-navy" : "shadow-lift ring-1 ring-line/70")}>
      {/* Inputs */}
      <form className="grid content-start gap-8 bg-card p-7 text-navy sm:p-10" onSubmit={(e) => (e.preventDefault(), setTouched(true))} noValidate>
        <div className="grid gap-3">
          <label htmlFor={ids.postcode} className="font-display text-xl font-semibold">
            Your postcode
          </label>
          <input
            id={ids.postcode}
            name="postcode"
            inputMode="text"
            autoComplete="postal-code"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={10}
            placeholder="CA14 3XX"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={showInvalid || undefined}
            aria-describedby={ids.hint}
            className={cn(
              "min-h-16 w-full rounded-md bg-canvas px-5 font-display text-2xl font-semibold uppercase tracking-[0.02em] text-navy placeholder:font-normal placeholder:normal-case placeholder:text-navy-3",
              "ring-1 ring-inset ring-line transition-shadow focus:outline-none focus:ring-2 focus:ring-navy",
              showInvalid && "ring-2 ring-bad focus:ring-bad",
            )}
          />
          <p id={ids.hint} data-instant-hint className={cn("text-base", showInvalid ? "font-medium text-bad" : "text-navy-3")} role={showInvalid ? "alert" : undefined}>
            {showInvalid ? "That doesn’t look like a UK postcode. Try something like CA14 3XX." : "Just the first half works too, like CA28."}
          </p>
        </div>

        <div className="grid gap-3">
          <span id={ids.hours} className="font-display text-xl font-semibold">
            How long
          </span>
          <div role="group" aria-labelledby={ids.hours} className="flex items-center gap-3">
            <StepButton label="Half an hour less" disabled={atMin} onClick={() => step(-1)}>
              <path d="M5 12h14" />
            </StepButton>
            <output aria-live="polite" className="min-w-0 flex-1 text-center font-display text-[clamp(2rem,1.5rem+1.5vw,2.75rem)] font-semibold leading-none tabular">
              {formatDuration(minutes)}
            </output>
            <StepButton label="Half an hour more" disabled={atMax} onClick={() => step(1)}>
              <path d="M5 12h14M12 5v14" />
            </StepButton>
          </div>
          <p className="text-base text-navy-3">
            {formatDuration(pricing.minBookingMinutes)} minimum. Not sure? Start there: your cleaner will tell you after the first visit if your home needs longer.
          </p>
        </div>
      </form>

      {/* Result */}
      <div id={ids.result} data-instant-result aria-live="polite" className="relative grid content-between gap-10 overflow-hidden signal-waves p-7 text-on-navy sm:p-10">
        {parsed.kind === "empty" || parsed.kind === "invalid" ? (
          <Result eyebrow="Every clean" price={price} minutes={minutes} pph={pricing.pricePerHourPence}>
            Put your postcode in to check we&rsquo;re booking in your area.
          </Result>
        ) : covered ? (
          <Result eyebrow={`Booking in ${parsed.district}`} price={price} minutes={minutes} pph={pricing.pricePerHourPence} good>
            Charged only after each clean is finished. Same price every visit, whichever day you choose.
          </Result>
        ) : (
          <div className="grid gap-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal">Not in {parsed.district} yet</p>
            <p className="font-display text-3xl font-semibold">We&rsquo;re not booking there yet.</p>
            <p className="text-lg text-on-navy-2">
              Ping opens a postcode when there are enough vetted local cleaners to look after it properly. We&rsquo;re growing across West Cumbria first.
            </p>
            <Link href="/areas" className="inline-flex min-h-12 w-fit items-center gap-2 font-semibold text-teal hover:text-on-navy">
              See where we clean <span aria-hidden>&rarr;</span>
            </Link>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 border-t border-line-navy pt-6">
          {(parsed.kind !== "full" && parsed.kind !== "district") || covered ? (
          <ButtonLink
            href={`/account/book?${new URLSearchParams({ ...(parsed.kind === "full" ? { postcode: parsed.postcode } : {}), minutes: String(minutes) })}` as Route}
            size="lg"
            variant={covered ? "signal" : "onNavy"}
          >
            {covered ? "Book this clean" : "Start a booking"}
          </ButtonLink>
          ) : null}
          <span className="text-base text-on-navy-2">No contract. Book up to 8 cleans; rebook any time.</span>
        </div>
      </div>
    </div>
  );
}

function Result({ eyebrow, price, minutes, pph, good = false, children }: { eyebrow: string; price: number; minutes: number; pph: number; good?: boolean; children: ReactNode }) {
  return (
    <div className="grid gap-5">
      <p className={cn("flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em]", good ? "text-ok-on-navy" : "text-teal")}>
        {good ? (
          <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
            <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
        {eyebrow}
      </p>
      <p className="font-display text-[clamp(4rem,2.8rem+4.5vw,7rem)] font-semibold leading-[0.9] tracking-[-0.045em] tabular">
        {formatPenceShort(price)}
        <span className="ml-3 align-baseline font-sans text-xl font-semibold tracking-normal text-on-navy-2">a clean</span>
      </p>
      <p className="text-lg text-on-navy-2">
        {formatDuration(minutes)} at {formatPence(pph)} an hour. {children}
      </p>
    </div>
  );
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-16 shrink-0 place-items-center rounded-full bg-canvas text-navy ring-1 ring-inset ring-line transition-[background-color,transform] hover:bg-mist active:scale-95 disabled:opacity-35"
    >
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        {children}
      </svg>
    </button>
  );
}

/** Prices not set yet, or the database couldn't be reached. Never a made-up number. */
function NotOpen({ status, tone }: { status: "soon" | "unavailable"; tone: "card" | "ink" }) {
  const soon = status === "soon";
  return (
    <div className={cn("signal-waves relative grid gap-10 overflow-hidden rounded-xl p-8 text-on-navy sm:p-12 lg:grid-cols-12 lg:items-end lg:p-16", tone === "ink" && "ring-1 ring-line-navy")}>
      <svg aria-hidden viewBox="0 0 600 600" className="pointer-events-none absolute -bottom-72 -right-56 size-[40rem] text-on-navy/[0.07]">
        {[80, 150, 220, 290].map((r) => (
          <circle key={r} cx="300" cy="300" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
        ))}
      </svg>
      <div className="relative grid gap-5 lg:col-span-7">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal">Instant price</p>
        <p className="font-display text-3xl font-semibold">{soon ? "Booking opens soon." : "Prices didn’t load."}</p>
      </div>
      <div className="relative grid gap-6 lg:col-span-5">
        <p className="text-lg text-on-navy-2">
          {soon
            ? "We’re setting our prices and signing up local cleaners now. When booking opens, put in your postcode and hours here and you’ll see the exact price of a clean before you commit to anything."
            : "It’s probably a weak signal on our side or yours. Refresh the page to try again."}
        </p>
        <Link href="/#how" className="inline-flex min-h-12 w-fit items-center gap-2 font-semibold text-teal hover:text-on-navy">
          How Ping works <span aria-hidden>&rarr;</span>
        </Link>
      </div>
    </div>
  );
}
