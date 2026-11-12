"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, cn } from "@/components/ui";
import { registerInterestOnHoldingPage, registerInterestOnInstantPrice } from "@/lib/interest/actions";
import {
  INTEREST_FIELDS,
  INTEREST_NOTIFY_LABEL,
  initialInterestState,
  interestConsentText,
  type RegisterInterestState,
} from "@/lib/interest/form";

/** What the Server Component reads with interestFormSetup() and hands down. */
export type InterestSetup = { retentionMonths: number | null; turnstileSiteKey: string | null };

type Source = "instant_price" | "holding_page";

/**
 * "Tell me when booking opens near me". Lives on navy panels: the instant-price result
 * outside the launch area, and the "Booking opens soon" state.
 *
 * The source is chosen by which Server Action this uses, never sent from the page. The
 * reply is always the same "thanks", so nobody can tell whether someone was already on
 * the list. Built for one thumb at 390px: big fields, a full-width toggle and button.
 */
export function RegisterInterest({
  source,
  setup,
  initialPostcode = "",
  className,
}: {
  source: Source;
  setup: InterestSetup;
  initialPostcode?: string;
  className?: string;
}) {
  const [state, action, pending] = useActionState<RegisterInterestState, FormData>(
    source === "instant_price" ? registerInterestOnInstantPrice : registerInterestOnHoldingPage,
    initialInterestState,
  );
  const ids = { postcode: useId(), contact: useId(), email: useId(), phone: useId(), notify: useId(), err: useId() };

  const [postcode, setPostcode] = useState(initialPostcode);
  const [contact, setContact] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notify, setNotify] = useState(false);

  // Follow the instant-price postcode until the person edits it here.
  const [lastInitial, setLastInitial] = useState(initialPostcode);
  if (initialPostcode !== lastInitial) {
    setLastInitial(initialPostcode);
    setPostcode(initialPostcode);
  }
  // Refused: put back exactly what they typed (the server echoes it).
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state.status === "error") {
      setPostcode(state.values.postcode);
      setContact(state.values.contact);
      setEmail(state.values.email);
      setPhone(state.values.phone);
      setNotify(state.values.notify);
    }
  }

  if (setup.retentionMonths === null) return null; // registering is switched off

  if (state.status === "thanks") {
    return (
      <div role="status" className={cn("grid gap-4 rounded-lg bg-white/6 p-6 ring-1 ring-inset ring-white/15 sm:p-8", className)}>
        <span className="grid size-12 place-items-center rounded-full bg-teal text-navy" aria-hidden>
          <svg viewBox="0 0 20 20" className="size-6">
            <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <p className="font-display text-2xl font-semibold">Thanks. We&rsquo;ll be in touch.</p>
        <p className="text-lg text-on-navy-2">If you ticked the box, we&rsquo;ll send you one message when booking opens near you. Nothing else.</p>
      </div>
    );
  }

  const fe = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const formError = state.status === "error" ? state.message : undefined;

  return (
    <form
      noValidate
      aria-describedby={formError ? ids.err : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className={cn("grid gap-6", className)}
    >
      {/* Honeypot: hidden from people and screen readers; bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Company
          <input type="text" name={INTEREST_FIELDS.honeypot} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      {formError ? (
        <p id={ids.err} role="alert" className="rounded-md bg-bad-soft px-5 py-4 text-base font-semibold text-bad">
          {formError}
        </p>
      ) : null}

      <NavyField id={ids.postcode} label="Your postcode" error={fe.postcode}>
        <input
          id={ids.postcode}
          name={INTEREST_FIELDS.postcode}
          value={postcode}
          onChange={(e) => setPostcode(e.target.value.toUpperCase())}
          autoComplete="postal-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={10}
          placeholder="CA14 3XX"
          aria-invalid={fe.postcode ? true : undefined}
          aria-describedby={fe.postcode ? `${ids.postcode}-error` : undefined}
          className={inputClass(Boolean(fe.postcode))}
        />
      </NavyField>

      <fieldset className="grid gap-3">
        <legend className="mb-3 text-base font-semibold">How should we tell you?</legend>
        <input type="hidden" name={INTEREST_FIELDS.contact} value={contact} />
        <div className="grid grid-cols-2 gap-1 rounded-full bg-white/8 p-1 ring-1 ring-inset ring-white/15">
          {(["email", "phone"] as const).map((c) => (
            <label
              key={c}
              className={cn(
                "flex min-h-12 cursor-pointer items-center justify-center rounded-full text-base font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-glow",
                contact === c ? "bg-teal text-navy" : "text-on-navy-2 hover:text-on-navy",
              )}
            >
              <input type="radio" name={`${ids.contact}-choice`} checked={contact === c} onChange={() => setContact(c)} className="sr-only" />
              {c === "email" ? "Email" : "Text message"}
            </label>
          ))}
        </div>
        {contact === "email" ? (
          <NavyField id={ids.email} label="Email address" error={fe.email}>
            <input
              id={ids.email}
              name={INTEREST_FIELDS.email}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              aria-invalid={fe.email ? true : undefined}
              aria-describedby={fe.email ? `${ids.email}-error` : undefined}
              className={inputClass(Boolean(fe.email))}
            />
          </NavyField>
        ) : (
          <NavyField id={ids.phone} label="UK mobile number" error={fe.phone}>
            <input
              id={ids.phone}
              name={INTEREST_FIELDS.phone}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07700 900123"
              aria-invalid={fe.phone ? true : undefined}
              aria-describedby={fe.phone ? `${ids.phone}-error` : undefined}
              className={inputClass(Boolean(fe.phone))}
            />
          </NavyField>
        )}
      </fieldset>

      <div className="grid gap-2">
        <label
          htmlFor={ids.notify}
          className={cn(
            "flex min-h-16 cursor-pointer items-center gap-4 rounded-lg px-5 py-4 ring-1 ring-inset transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-glow",
            notify ? "bg-white/10 ring-teal" : fe.notify ? "bg-white/5 ring-bad-on-navy" : "bg-white/5 ring-white/20 hover:ring-white/40",
          )}
        >
          <input
            id={ids.notify}
            type="checkbox"
            name={INTEREST_FIELDS.notify}
            value="on"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            aria-invalid={fe.notify ? true : undefined}
            aria-describedby={fe.notify ? `${ids.notify}-error` : `${ids.notify}-hint`}
            className="peer sr-only"
          />
          <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-[0.45rem] ring-2", notify ? "bg-teal ring-teal text-navy" : "ring-white/50")}>
            {notify ? (
              <svg viewBox="0 0 20 20" className="size-5">
                <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </span>
          <span className="text-lg font-semibold">{INTEREST_NOTIFY_LABEL}</span>
        </label>
        {fe.notify ? (
          <p id={`${ids.notify}-error`} role="alert" className="text-base font-medium text-bad-on-navy">
            {fe.notify}
          </p>
        ) : (
          <p id={`${ids.notify}-hint`} className="text-base text-on-navy-3">
            Required. Without the tick we don&rsquo;t keep anything.
          </p>
        )}
      </div>

      {setup.turnstileSiteKey ? <Turnstile siteKey={setup.turnstileSiteKey} error={fe.captcha} /> : null}

      <Button type="submit" size="xl" variant="signal" pending={pending} className="w-full">
        Let me know
      </Button>

      <p className="text-base text-on-navy-2">
        {interestConsentText(setup.retentionMonths)}{" "}
        <Link href="/privacy" className="font-semibold text-teal underline decoration-teal/40 underline-offset-4 hover:text-on-navy">
          Privacy notice
        </Link>
      </p>
    </form>
  );
}

const inputClass = (bad: boolean) =>
  cn(
    "min-h-14 w-full rounded-md bg-white px-4 text-lg text-navy placeholder:text-navy-3",
    "ring-1 ring-inset ring-white/30 focus:outline-none focus:ring-2 focus:ring-teal-glow",
    bad && "ring-2 ring-bad-on-navy",
  );

function NavyField({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-base font-semibold">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-base font-medium text-bad-on-navy">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type TurnstileApi = { render: (el: HTMLElement, opts: { sitekey: string; theme?: string }) => string; remove: (id: string) => void };

/**
 * Cloudflare Turnstile, rendered explicitly so it also works when the form appears after
 * the page has loaded. It adds its own hidden "cf-turnstile-response" field to the form.
 */
function Turnstile({ siteKey, error }: { siteKey: string; error?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    if (!document.querySelector(`script[src="${SRC}"]`)) {
      const s = document.createElement("script");
      s.src = SRC;
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
    let widget: string | null = null;
    const timer = window.setInterval(() => {
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (api && ref.current && widget === null) {
        widget = api.render(ref.current, { sitekey: siteKey, theme: "dark" });
        window.clearInterval(timer);
      }
    }, 150);
    return () => {
      window.clearInterval(timer);
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (api && widget) api.remove(widget);
    };
  }, [siteKey]);
  return (
    <div className="grid gap-2">
      <div ref={ref} className="min-h-[65px]" />
      {error ? (
        <p role="alert" className="text-base font-medium text-bad-on-navy">
          {error}
        </p>
      ) : null}
    </div>
  );
}
