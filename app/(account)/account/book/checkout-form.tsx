"use client";

import { startTransition, useActionState, useEffect, useId, useState, type ReactNode } from "react";
import { Button, Field, cn } from "@/components/ui";
import { formatDay, formatTime, weekdayName } from "@/lib/dates";
import { formatDuration, formatPence, formatPenceShort } from "@/lib/money";
import { ARRIVALS, DEFAULT_BLOCK, FREQUENCIES, blockTotalPence, cleanWindow, firstCleanDate, lastCleanDate, type ArrivalId, type FrequencyId } from "../../../(site)/_lib/checkout";
import { parsePostcode } from "../../../(site)/_lib/postcode";
import type { PricingState } from "../../../(site)/_lib/pricing-shape";
import { MAX_MINUTES, STEP_MINUTES, clampMinutes, quotePence } from "../../../(site)/_lib/quote";
import { confirmBooking, type BookState } from "./actions";

type Open = Extract<PricingState, { status: "open" }>;
type Home = { id: string; address_line1: string; town: string; postcode: string; bedrooms: number; bathrooms: number };

const DAYS = [1, 2, 3, 4, 5, 6, 7];
const BLOCKS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Checkout: home → how often → when → how long and how many → card → confirm.
 * The summary is a preview from the public price; book_series sets the real figures.
 */
export function CheckoutForm({
  pricing,
  homes,
  initialPostcode,
  initialMinutes,
  earliestStart,
}: {
  pricing: Open;
  homes: Home[];
  initialPostcode: string;
  initialMinutes: number;
  earliestStart: string;
}) {
  const [state, action, pending] = useActionState<BookState, FormData>(confirmBooking, {});
  const [home, setHome] = useState<string>(homes.length ? homes[homes.length - 1]!.id : "new");
  const [postcode, setPostcode] = useState(initialPostcode);
  const [frequency, setFrequency] = useState<FrequencyId>("weekly");
  const [day, setDay] = useState<number | null>(null);
  const [arrival, setArrival] = useState<ArrivalId>("morning");
  const [minutes, setMinutes] = useState(initialMinutes);
  const [startsOn, setStartsOn] = useState(earliestStart);
  const [block, setBlock] = useState(DEFAULT_BLOCK);

  // One request id per checkout, made in the browser: a double tap or a retry sends the
  // same id, and book_series returns the same booking instead of making a second.
  const [requestId, setRequestId] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- must run in the browser only, once
    setRequestId(crypto.randomUUID());
  }, []);

  const f = state.fields ?? {};
  const district = (() => {
    const p = parsePostcode(postcode);
    return p.kind === "full" || p.kind === "district" ? p.district : null;
  })();
  const covered = home !== "new" || (district !== null && pricing.launchDistricts.includes(district));
  const slot = cleanWindow(arrival, minutes);
  const perClean = quotePence(pricing.pricePerHourPence, minutes);
  const total = blockTotalPence(pricing.pricePerHourPence, minutes, block);
  const first = day ? firstCleanDate(startsOn, day) : null;
  const last = day ? lastCleanDate(startsOn, day, frequency, block) : null;
  const ready = Boolean(requestId && day && slot && covered && startsOn >= earliestStart);

  return (
    <form
      // Dispatched by hand rather than via the action prop: React resets a form after an
      // action, and a refused booking must keep everything the customer typed.
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || !ready) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="grid gap-8 lg:grid-cols-12 lg:gap-10"
      noValidate
    >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="home" value={home} />
      <input type="hidden" name="frequency" value={frequency} />
      <input type="hidden" name="preferredDay" value={day ?? ""} />
      <input type="hidden" name="arrival" value={arrival} />
      <input type="hidden" name="durationMinutes" value={minutes} />
      <input type="hidden" name="blockSize" value={block} />

      <div className="grid gap-6 lg:col-span-7">
        {/* 01 Home */}
        <Step n={1} title="Your home" error={f.home}>
          {homes.length ? (
            <div className="grid gap-3">
              {homes.map((h) => (
                <Choice key={h.id} name="home-choice" checked={home === h.id} onChange={() => setHome(h.id)}>
                  <span className="font-semibold">{h.address_line1}</span>
                  <span className="text-navy-2">
                    {h.town} {h.postcode} · {h.bedrooms} bed, {h.bathrooms} bath
                  </span>
                </Choice>
              ))}
              <Choice name="home-choice" checked={home === "new"} onChange={() => setHome("new")}>
                <span className="font-semibold">A different home</span>
              </Choice>
            </div>
          ) : null}

          {home === "new" ? (
            <div className={cn("grid gap-5 sm:grid-cols-2", homes.length > 0 && "mt-6 border-t border-line pt-6")}>
              <Field
                label="Postcode"
                name="postcode"
                autoComplete="postal-code"
                autoCapitalize="characters"
                value={postcode}
                onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                error={f.postcode ?? (district && !covered ? `We’re not booking in ${district} yet.` : undefined)}
                className="sm:col-span-2"
                required
              />
              <Field label="First line of address" name="addressLine1" autoComplete="address-line1" error={f.addressLine1} className="sm:col-span-2" required />
              <Field label="Second line (optional)" name="addressLine2" autoComplete="address-line2" error={f.addressLine2} />
              <Field label="Town or village" name="town" autoComplete="address-level2" error={f.town} required />
              <Counter label="Bedrooms" one="bedroom" name="bedrooms" initial={2} />
              <Counter label="Bathrooms" one="bathroom" name="bathrooms" initial={1} />
              <Field label="Pets (optional)" name="pets" placeholder="e.g. a friendly spaniel, stays in the garden" error={f.pets} className="sm:col-span-2" maxLength={200} />
              <TextArea label="Getting in (optional)" name="accessNotes" hint="Parking, which door, alarm. Only your cleaner sees this, once they’ve taken on your clean." error={f.accessNotes} />
              <Field label="Key safe code (optional)" name="keyCode" autoComplete="off" hint="Shown only to your cleaner, after they’ve taken on your clean." error={f.keyCode} maxLength={40} />
            </div>
          ) : null}
        </Step>

        {/* 02 How often */}
        <Step n={2} title="How often" error={f.frequency}>
          <div className="grid gap-3 sm:grid-cols-2">
            {FREQUENCIES.map((o) => (
              <Choice key={o.id} name="frequency-choice" checked={frequency === o.id} onChange={() => setFrequency(o.id)} big>
                <span className="font-display text-xl font-semibold">{o.label}</span>
              </Choice>
            ))}
          </div>
        </Step>

        {/* 03 When */}
        <Step n={3} title="When" error={f.preferredDay ?? f.arrival ?? f.startsOn}>
          <fieldset className="grid gap-3">
            <legend className="mb-3 text-base font-semibold">Day</legend>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {DAYS.map((d) => (
                <Chip key={d} name="day-choice" checked={day === d} onChange={() => setDay(d)} label={weekdayName(d)}>
                  {weekdayName(d).slice(0, 3)}
                </Chip>
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-8 grid gap-3">
            <legend className="mb-3 text-base font-semibold">Your cleaner arrives</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ARRIVALS.map((a) => {
                const fits = cleanWindow(a.id, minutes) !== null;
                return (
                  <Chip key={a.id} name="arrival-choice" checked={arrival === a.id} onChange={() => setArrival(a.id)} disabled={!fits} label={`${a.note}, ${a.label}`}>
                    <span className="block font-display text-lg font-semibold">{a.label}</span>
                    <span className="block text-sm text-navy-3">{fits ? a.note : "Too late for this length"}</span>
                  </Chip>
                );
              })}
            </div>
          </fieldset>
          <div className="mt-8 max-w-xs">
            <Field
              label="First clean from"
              name="startsOn"
              type="date"
              min={earliestStart}
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
              hint={first ? `First clean: ${formatDay(first)}` : "Pick a day above to see your first date."}
              error={f.startsOn}
              required
            />
          </div>
        </Step>

        {/* 04 How long, how many */}
        <Step n={4} title="How long, and how many" error={f.durationMinutes ?? f.blockSize}>
          <div className="flex items-center gap-3">
            <RoundButton label="Half an hour less" disabled={minutes <= pricing.minBookingMinutes} onClick={() => setMinutes((m) => clampMinutes(m - STEP_MINUTES, pricing.minBookingMinutes))}>
              <path d="M5 12h14" />
            </RoundButton>
            <output aria-live="polite" className="min-w-0 flex-1 whitespace-nowrap text-center font-display text-2xl font-semibold tabular sm:flex-none sm:min-w-[11rem] sm:text-3xl">
              {formatDuration(minutes)}
            </output>
            <RoundButton label="Half an hour more" disabled={minutes >= MAX_MINUTES} onClick={() => setMinutes((m) => clampMinutes(m + STEP_MINUTES, pricing.minBookingMinutes))}>
              <path d="M5 12h14M12 5v14" />
            </RoundButton>
          </div>
          <p className="mt-3 text-base text-navy-3">{formatDuration(pricing.minBookingMinutes)} minimum per clean.</p>

          <fieldset className="mt-8 grid gap-3">
            <legend className="mb-1 text-base font-semibold">Number of cleans</legend>
            <p className="mb-3 text-base text-navy-2">No contract. Book up to 8 cleans; rebook any time.</p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {BLOCKS.map((b) => (
                <Chip key={b} name="block-choice" checked={block === b} onChange={() => setBlock(b)} label={`${b} ${b === 1 ? "clean" : "cleans"}`}>
                  <span className="font-display text-2xl font-semibold tabular">{b}</span>
                </Chip>
              ))}
            </div>
          </fieldset>
        </Step>

        {/* 05 Card: A-4. Stripe SetupIntent and the Payment Element go here. */}
        <Step n={5} title="Your card" muted>
          <p className="text-lg text-navy-2">
            Card saving is switched on just before launch. We&rsquo;ll ask for your card before your first clean, and nothing is ever charged until a clean is finished.
          </p>
        </Step>
      </div>

      {/* Summary */}
      <aside aria-labelledby="summary-title" className="lg:col-span-5">
        <div className="relative grid gap-6 overflow-hidden rounded-xl signal-waves p-7 text-on-navy sm:p-9 lg:sticky lg:top-28">
          <h2 id="summary-title" className="text-sm font-semibold uppercase tracking-[0.16em] text-teal">
            Your booking
          </h2>
          <div aria-live="polite" className="grid gap-6">
            <div>
              <p className="font-display text-[clamp(3.25rem,2.4rem+3vw,5rem)] font-semibold leading-[0.9] tracking-[-0.04em] tabular">{formatPenceShort(perClean)}</p>
              <p className="mt-2 text-lg text-on-navy-2">
                a clean · {formatDuration(minutes)} at {formatPence(pricing.pricePerHourPence)} an hour
              </p>
            </div>
            <dl className="grid gap-3 border-t border-line-navy pt-6 text-lg">
              <Row label="Cleans">{block}</Row>
              <Row label="How often">{FREQUENCIES.find((x) => x.id === frequency)!.label}</Row>
              <Row label="Day">{day ? `${weekdayName(day)}s` : "Pick a day"}</Row>
              <Row label="Arrives">{ARRIVALS.find((a) => a.id === arrival)!.label}</Row>
              {first && last ? <Row label="Dates">{block === 1 ? formatDay(first) : `${formatDay(first)} to ${formatDay(last)}`}</Row> : null}
            </dl>
            <div className="flex items-baseline justify-between gap-4 border-t border-line-navy pt-6">
              <span className="text-lg text-on-navy-2">All {block} {block === 1 ? "clean" : "cleans"}</span>
              <span className="font-display text-3xl font-semibold tabular">{formatPence(total)}</span>
            </div>
            <p className="text-base text-on-navy-3">
              {slot ? `Your cleaner arrives ${ARRIVALS.find((a) => a.id === arrival)!.label} and is done by ${formatTime(slot.end)}. ` : ""}Paid one clean at a time, after each one is finished. If a cleaner takes your block on after the first date, the dates move later rather than you losing a clean.
            </p>
          </div>

          {state.error ? (
            <p role="alert" className="rounded-md bg-bad-soft px-5 py-4 text-base font-semibold text-bad">
              {state.error}
            </p>
          ) : null}

          <Button type="submit" size="xl" variant="signal" pending={pending} disabled={!ready} className="w-full">
            Book {block} {block === 1 ? "clean" : "cleans"}
          </Button>
          {!ready && !pending ? (
            <p className="-mt-2 text-center text-base text-on-navy-3">
              {!day ? "Pick a day to book." : !covered ? "We’re not booking at that postcode yet." : !slot ? "That clean would run past 8pm." : "Getting ready…"}
            </p>
          ) : null}
        </div>
      </aside>
    </form>
  );
}

// ---------------------------------------------------------------- pieces

function Step({ n, title, error, muted = false, children }: { n: number; title: string; error?: string; muted?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("rounded-xl p-7 ring-1 sm:p-9", muted ? "bg-mist/70 ring-line" : "bg-card shadow-card ring-line/70")}>
      <div className="mb-6 flex items-baseline gap-4">
        <span className="font-display text-2xl font-semibold text-teal-ink tabular" aria-hidden>
          {String(n).padStart(2, "0")}
        </span>
        <h2 id={id} className="text-2xl font-semibold">
          {title}
        </h2>
      </div>
      {children}
      {error ? (
        <p role="alert" className="mt-4 text-base font-medium text-bad">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function Choice({ name, checked, onChange, big = false, children }: { name: string; checked: boolean; onChange: () => void; big?: boolean; children: ReactNode }) {
  return (
    <label
      className={cn(
        "flex min-h-16 cursor-pointer items-center gap-4 rounded-lg px-5 ring-1 ring-inset transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal",
        big ? "py-5" : "py-4",
        checked ? "bg-navy text-on-navy ring-navy [&_.text-navy-2]:text-on-navy-2" : "bg-canvas ring-line hover:ring-navy-3",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-full ring-2", checked ? "ring-teal" : "ring-line")}>
        {checked ? <span className="size-2.5 rounded-full bg-teal" /> : null}
      </span>
      <span className="grid gap-0.5">{children}</span>
    </label>
  );
}

function Chip({ name, checked, onChange, disabled = false, label, children }: { name: string; checked: boolean; onChange: () => void; disabled?: boolean; label: string; children: ReactNode }) {
  return (
    <label
      className={cn(
        "grid min-h-14 cursor-pointer place-items-center rounded-md px-2 py-3 text-center font-semibold ring-1 ring-inset transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal",
        checked ? "bg-navy text-on-navy ring-navy [&_.text-navy-3]:text-on-navy-2" : "bg-canvas ring-line hover:ring-navy-3",
        disabled && "cursor-not-allowed opacity-45 hover:ring-line",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} aria-label={label} className="sr-only" />
      <span>{children}</span>
    </label>
  );
}

function Counter({ label, one, name, initial }: { label: string; one: string; name: string; initial: number }) {
  const [n, setN] = useState(initial);
  const id = useId();
  return (
    <div className="grid gap-2">
      <span id={id} className="text-sm font-semibold">
        {label}
      </span>
      <div role="group" aria-labelledby={id} className="flex items-center gap-3">
        <RoundButton label={`Remove a ${one}`} disabled={n <= 0} onClick={() => setN((x) => Math.max(0, x - 1))} small>
          <path d="M5 12h14" />
        </RoundButton>
        <output className="min-w-10 text-center font-display text-2xl font-semibold tabular">{n}</output>
        <RoundButton label={`Add a ${one}`} disabled={n >= 12} onClick={() => setN((x) => Math.min(12, x + 1))} small>
          <path d="M5 12h14M12 5v14" />
        </RoundButton>
      </div>
      <input type="hidden" name={name} value={n} />
    </div>
  );
}

function TextArea({ label, name, hint, error }: { label: string; name: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <div className="grid gap-2 sm:col-span-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={3}
        maxLength={1000}
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-invalid={error ? true : undefined}
        className={cn("w-full rounded-md bg-card px-4 py-3 text-base ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-navy", error && "ring-2 ring-bad")}
      />
      {error ? <p className="text-sm font-medium text-bad">{error}</p> : hint ? <p id={`${id}-hint`} className="text-sm text-navy-3">{hint}</p> : null}
    </div>
  );
}

function RoundButton({ label, disabled, onClick, small = false, children }: { label: string; disabled: boolean; onClick: () => void; small?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-canvas text-navy ring-1 ring-inset ring-line transition-[background-color,transform] hover:bg-mist active:scale-95 disabled:opacity-35",
        small ? "size-12" : "size-14",
      )}
    >
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        {children}
      </svg>
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-on-navy-3">{label}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}
