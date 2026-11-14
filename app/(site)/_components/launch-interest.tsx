"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, cn } from "@/components/ui";
import { registerLaunchInterest } from "@/lib/interest/actions";
import {
  LAUNCH_FIELDS,
  LAUNCH_NAME_MAX,
  LAUNCH_NOTE,
  LAUNCH_NOTE_MAX,
  LAUNCH_NOTIFY_LABEL,
  LAUNCH_QUESTIONS,
  initialLaunchState,
  launchConsentText,
  type LaunchInterestState,
  type LaunchKind,
  type LaunchQuestion,
} from "@/lib/interest/launch";
import { Turnstile, type InterestSetup } from "./register-interest";

const KIND_CHOICE: Record<LaunchKind, { title: string; note: string; submit: string }> = {
  customer: { title: "I want a cleaner", note: "Register as a customer", submit: "Put me on the list" },
  cleaner: { title: "I want to clean", note: "Register to clean with Ping", submit: "Join the cleaners’ list" },
};

/**
 * The launch form: a customer or a would-be cleaner leaves a postcode and one way to reach
 * them, ticks the box, and (if they like) answers a few tap questions. A white card that
 * sits on the navy "Register" panel of /launch.
 *
 * Only the contact, the postcode and the tick are required; every question is optional and
 * says so. The reply is always the same "thanks", so nobody can tell who is already on the
 * list. Built for one thumb at 390px: 48px+ targets, nothing side by side that can't stack.
 */
export function LaunchInterest({ setup, initialKind = "customer", className }: { setup: InterestSetup; initialKind?: LaunchKind; className?: string }) {
  const [state, action, pending] = useActionState<LaunchInterestState, FormData>(registerLaunchInterest, initialLaunchState);
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;

  const [kind, setKind] = useState<LaunchKind>(initialKind);
  const [firstName, setFirstName] = useState("");
  const [postcode, setPostcode] = useState("");
  const [contact, setContact] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notify, setNotify] = useState(false);
  // Answers are kept per kind, so switching sides and back loses nothing.
  const [answers, setAnswers] = useState<Record<LaunchKind, Record<string, string[]>>>({ customer: {}, cleaner: {} });
  const [note, setNote] = useState<Record<LaunchKind, string>>({ customer: "", cleaner: "" });

  // A "Register as a cleaner" button elsewhere on the page changes the side shown here.
  const [lastInitial, setLastInitial] = useState(initialKind);
  if (initialKind !== lastInitial) {
    setLastInitial(initialKind);
    setKind(initialKind);
  }
  // Refused: put back exactly what they typed (the server echoes it).
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state.status === "error") {
      const v = state.values;
      setKind(v.kind);
      setFirstName(v.firstName);
      setPostcode(v.postcode);
      setContact(v.contact);
      setEmail(v.email);
      setPhone(v.phone);
      setNotify(v.notify);
      setAnswers((a) => ({ ...a, [v.kind]: v.answers }));
      setNote((n) => ({ ...n, [v.kind]: v.note }));
    }
  }

  // Sent: the long form becomes a short card, so bring that card into view and move focus
  // to it. Otherwise the page shrinks under the reader and they are left looking at the footer.
  const thanksRef = useRef<HTMLDivElement>(null);
  const sent = state.status === "thanks";
  useEffect(() => {
    if (!sent || !thanksRef.current) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    thanksRef.current.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
    thanksRef.current.focus({ preventScroll: true });
  }, [sent]);

  if (setup.retentionMonths === null) return null; // registering is switched off

  if (state.status === "thanks") {
    const cleaner = state.kind === "cleaner";
    return (
      <div
        ref={thanksRef}
        tabIndex={-1}
        role="status"
        className={cn("grid content-center gap-6 rounded-xl bg-card p-8 text-navy shadow-lift focus:outline-none sm:p-12 lg:min-h-[30rem] lg:p-16", className)}
      >
        <span className="grid size-16 place-items-center rounded-full bg-teal text-navy" aria-hidden>
          <svg viewBox="0 0 20 20" className="size-8">
            <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <p className="font-display text-3xl font-semibold">Thanks. You&rsquo;re on the list.</p>
        <p className="max-w-xl text-lg text-navy-2">
          {cleaner
            ? "We’ll send you one message when Ping is taking on cleaners near you. Until then, there’s nothing more you need to do."
            : "We’ll send you one message when booking opens near you. Until then, there’s nothing more you need to do."}
        </p>
        <Link
          href={cleaner ? "/clean-for-ping" : "/#how"}
          className="inline-block w-fit py-3 text-lg font-semibold text-blue underline decoration-blue/30 underline-offset-4 hover:decoration-blue"
        >
          {cleaner ? "See how cleaning with Ping works" : "See how a Ping clean works"}
          <span aria-hidden>&nbsp;&rarr;</span>
        </Link>
      </div>
    );
  }

  const fe = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const formError = state.status === "error" ? state.message : undefined;
  const questions = LAUNCH_QUESTIONS[kind];
  const mine = answers[kind];
  const answered = questions.filter((q) => (mine[q.key]?.length ?? 0) > 0).length;

  const pick = (q: LaunchQuestion, value: string) =>
    setAnswers((all) => {
      const had = all[kind][q.key] ?? [];
      const next =
        q.pick === "one" ? (had[0] === value ? [] : [value])
        : had.includes(value) ? had.filter((v) => v !== value)
        : had.length >= (q.max ?? q.options.length) ? had
        : [...had, value];
      return { ...all, [kind]: { ...all[kind], [q.key]: next } };
    });

  return (
    <form
      noValidate
      aria-describedby={formError ? id("error") : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className={cn("grid min-w-0 gap-10 rounded-xl bg-card p-6 text-navy shadow-lift sm:p-10 lg:p-14", className)}
    >
      {/* Honeypot: hidden from people and screen readers; bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Company
          <input type="text" name={LAUNCH_FIELDS.honeypot} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <input type="hidden" name={LAUNCH_FIELDS.kind} value={kind} />
      <input type="hidden" name={LAUNCH_FIELDS.contact} value={contact} />

      {/* ---------------------------------------------------------- which side */}
      <fieldset className="min-w-0">
        <legend className="sr-only">I am registering as</legend>
        <div className="grid gap-2 rounded-lg bg-mist p-2 sm:grid-cols-2">
          {(["customer", "cleaner"] as const).map((k) => (
            <label
              key={k}
              className={cn(
                "grid min-h-[4.5rem] cursor-pointer content-center gap-0.5 rounded-md px-5 py-3 transition-[background-color,color,box-shadow] duration-200 ease-out-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue",
                kind === k ? "bg-navy text-on-navy shadow-card" : "text-navy hover:bg-card/70",
              )}
            >
              <input type="radio" name={id("side")} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
              <span className="font-display text-xl font-semibold">{KIND_CHOICE[k].title}</span>
              <span className={cn("text-base lg:text-lg", kind === k ? "text-on-navy-2" : "text-navy-2")}>{KIND_CHOICE[k].note}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {formError ? (
        <p id={id("error")} role="alert" className="rounded-md bg-bad-soft px-5 py-4 text-base font-semibold text-bad">
          {formError}
        </p>
      ) : null}

      {/* ---------------------------------------------------------- who and where */}
      <div className="grid gap-6 sm:grid-cols-2">
        <LightField id={id("name")} label="First name" optional error={fe.firstName}>
          <input
            id={id("name")}
            name={LAUNCH_FIELDS.firstName}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            maxLength={LAUNCH_NAME_MAX}
            aria-invalid={fe.firstName ? true : undefined}
            aria-describedby={fe.firstName ? `${id("name")}-error` : undefined}
            className={inputClass(Boolean(fe.firstName))}
          />
        </LightField>
        <LightField id={id("postcode")} label="Your postcode" error={fe.postcode}>
          <input
            id={id("postcode")}
            name={LAUNCH_FIELDS.postcode}
            value={postcode}
            onChange={(e) => setPostcode(e.target.value.toUpperCase())}
            autoComplete="postal-code"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={10}
            placeholder="CA14 3XX"
            aria-invalid={fe.postcode ? true : undefined}
            aria-describedby={fe.postcode ? `${id("postcode")}-error` : undefined}
            className={inputClass(Boolean(fe.postcode))}
          />
        </LightField>
      </div>

      <fieldset className="grid min-w-0 gap-4">
        <legend className="mb-4 text-lg font-semibold">How should we tell you?</legend>
        <div className="grid grid-cols-2 gap-1 rounded-full bg-mist p-1">
          {(["email", "phone"] as const).map((c) => (
            <label
              key={c}
              className={cn(
                "flex min-h-12 cursor-pointer items-center justify-center rounded-full text-base font-semibold transition-colors duration-200 lg:text-lg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue",
                contact === c ? "bg-card text-navy shadow-card" : "text-navy-2 hover:text-navy",
              )}
            >
              <input type="radio" name={id("contact")} checked={contact === c} onChange={() => setContact(c)} className="sr-only" />
              {c === "email" ? "Email" : "Text message"}
            </label>
          ))}
        </div>
        {contact === "email" ? (
          <LightField id={id("email")} label="Email address" error={fe.email}>
            <input
              id={id("email")}
              name={LAUNCH_FIELDS.email}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              aria-invalid={fe.email ? true : undefined}
              aria-describedby={fe.email ? `${id("email")}-error` : undefined}
              className={inputClass(Boolean(fe.email))}
            />
          </LightField>
        ) : (
          <LightField id={id("phone")} label="UK mobile number" error={fe.phone}>
            <input
              id={id("phone")}
              name={LAUNCH_FIELDS.phone}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07700 900123"
              aria-invalid={fe.phone ? true : undefined}
              aria-describedby={fe.phone ? `${id("phone")}-error` : undefined}
              className={inputClass(Boolean(fe.phone))}
            />
          </LightField>
        )}
      </fieldset>

      {/* ---------------------------------------------------------- the tick: required, so it sits with the required fields */}
      <div className="grid gap-2">
        <label
          htmlFor={id("notify")}
          className={cn(
            "flex min-h-16 cursor-pointer items-center gap-4 rounded-lg px-5 py-4 ring-1 ring-inset transition-[background-color,box-shadow] duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue",
            notify ? "bg-teal-soft ring-2 ring-teal-deep" : fe.notify ? "bg-card ring-2 ring-bad" : "bg-card shadow-card ring-navy-3/55 hover:ring-navy",
          )}
        >
          <input
            id={id("notify")}
            type="checkbox"
            name={LAUNCH_FIELDS.notify}
            value="on"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            aria-invalid={fe.notify ? true : undefined}
            aria-describedby={fe.notify ? `${id("notify")}-error` : `${id("notify")}-hint`}
            className="peer sr-only"
          />
          <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-sm ring-2", notify ? "bg-navy text-white ring-navy" : "bg-card ring-navy-3")}>
            {notify ? (
              <svg viewBox="0 0 20 20" className="size-5">
                <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </span>
          <span className="text-lg font-semibold">{LAUNCH_NOTIFY_LABEL[kind]}</span>
        </label>
        {fe.notify ? (
          <p id={`${id("notify")}-error`} role="alert" className="text-base font-medium text-bad">
            {fe.notify}
          </p>
        ) : (
          <p id={`${id("notify")}-hint`} className="text-base text-navy-2 lg:text-lg">
            We need this tick to keep your details. Without it, nothing is saved.
          </p>
        )}
      </div>

      {/* ---------------------------------------------------------- the short questions */}
      <section aria-labelledby={id("questions")} className="grid gap-8 border-t border-line pt-10">
        <div className="grid gap-6">
          <div className="grid gap-3">
            <h3 id={id("questions")} className="text-2xl font-semibold">
              {kind === "customer" ? "A few quick questions about your home" : "A few quick questions about your work"}
            </h3>
            <p className="text-lg text-navy-2">All optional. Tap what fits; skip what doesn&rsquo;t.</p>
          </div>
          {/* How far through: a real count of the questions answered, not decoration. */}
          <div className="grid w-full grid-cols-[auto_1fr] items-center gap-4">
            <p className="text-base font-semibold text-navy-2 tabular lg:text-lg" aria-live="polite">
              {answered} of {questions.length} answered
            </p>
            <div aria-hidden className="h-2 overflow-hidden rounded-full bg-mist">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-blue)_0%,var(--color-teal)_100%)] transition-[width] duration-500 ease-out-soft"
                style={{ width: `${(answered / questions.length) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {questions.map((q) => {
          const chosen = mine[q.key] ?? [];
          const max = q.max ?? q.options.length;
          const full = q.pick === "many" && chosen.length >= max;
          return (
            <fieldset key={`${kind}-${q.key}`} className="grid min-w-0 gap-4">
              <legend className="mb-4 text-lg font-semibold">
                {q.label}
                {q.pick === "many" ? <span className="mt-1 block text-base font-normal text-navy-2 lg:text-lg">{max < q.options.length ? `Pick up to ${max}.` : "Pick all that apply."}</span> : null}
              </legend>
              <div className="flex flex-wrap gap-2.5">
                {q.options.map((o) => {
                  const on = chosen.includes(o.value);
                  return (
                    <label
                      key={o.value}
                      className={cn(
                        "inline-flex min-h-12 min-w-14 max-w-full cursor-pointer select-none items-center justify-center gap-2 rounded-full px-5 py-2.5 text-left text-base font-semibold leading-snug lg:text-lg transition-[background-color,color,box-shadow,transform] duration-200 ease-out-soft active:scale-[0.97] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue has-[:focus-visible]:ring-offset-2",
                        on ? "bg-blue text-white shadow-card" : "bg-card text-navy shadow-card ring-1 ring-inset ring-navy-3/55 hover:ring-navy",
                        !on && full && "cursor-not-allowed opacity-50 shadow-none hover:ring-navy-3/55",
                      )}
                    >
                      {/* Checkboxes throughout, so a single choice can be untapped again. */}
                      <input
                        type="checkbox"
                        name={LAUNCH_FIELDS.answer(q.key)}
                        value={o.value}
                        checked={on}
                        disabled={!on && full}
                        onChange={() => pick(q, o.value)}
                        className="sr-only"
                      />
                      {on ? (
                        <svg viewBox="0 0 20 20" className="-ml-1 size-5 shrink-0" aria-hidden>
                          <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null}
                      {o.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        <div className="grid gap-3">
          <label htmlFor={id("note")} className="text-lg font-semibold">
            {LAUNCH_NOTE[kind].label}
            <span className="mt-1 block text-base font-normal text-navy-2 lg:text-lg">Optional</span>
          </label>
          <textarea
            id={id("note")}
            name={LAUNCH_FIELDS.note}
            value={note[kind]}
            onChange={(e) => setNote((n) => ({ ...n, [kind]: e.target.value }))}
            rows={4}
            maxLength={LAUNCH_NOTE_MAX}
            placeholder={LAUNCH_NOTE[kind].placeholder}
            aria-invalid={fe.note ? true : undefined}
            aria-describedby={fe.note ? `${id("note")}-error` : note[kind].length >= NOTE_COUNT_FROM ? `${id("note")}-count` : undefined}
            className={cn(inputClass(Boolean(fe.note)), "min-h-32 resize-y py-4 leading-relaxed")}
          />
          {fe.note ? (
            <p id={`${id("note")}-error`} role="alert" className="text-base font-medium text-bad">
              {fe.note}
            </p>
          ) : note[kind].length >= NOTE_COUNT_FROM ? (
            <p id={`${id("note")}-count`} className="text-base text-navy-2 tabular lg:text-lg" aria-live="polite">
              {LAUNCH_NOTE_MAX - note[kind].length} characters left
            </p>
          ) : null}
        </div>
      </section>

      {/* ---------------------------------------------------------- send */}
      {setup.turnstileSiteKey ? (
        <div className="border-t border-line pt-10">
          <Turnstile siteKey={setup.turnstileSiteKey} error={fe.captcha} theme="light" />
        </div>
      ) : (
        <hr className="border-line" />
      )}

      {/* On a phone the questions make a long form. This is a direct child of the form, so it
          rides the bottom of the screen for as long as the form is in view, then settles into
          its place at the end: sending is always one tap away. */}
      <div data-send className="max-sm:sticky max-sm:bottom-3 max-sm:z-10 max-sm:-mx-2 max-sm:rounded-full max-sm:bg-card/85 max-sm:p-1.5 max-sm:shadow-lift max-sm:backdrop-blur">
        <Button type="submit" size="xl" variant="primary" pending={pending} className="w-full max-sm:px-6">
          {KIND_CHOICE[kind].submit}
        </Button>
      </div>

      <p className="text-base text-navy-2 lg:text-lg">
        {launchConsentText(kind, setup.retentionMonths)}{" "}
        <Link href="/privacy" className="font-semibold text-blue underline decoration-blue/30 underline-offset-4 hover:decoration-blue">
          Privacy notice
        </Link>
      </p>
    </form>
  );
}

/** Show "characters left" only once the note is getting long. */
const NOTE_COUNT_FROM = LAUNCH_NOTE_MAX - 100;

// White fields with a firm edge and a soft lift, so an empty field never reads as disabled.
const inputClass = (bad: boolean) =>
  cn(
    "min-h-14 w-full min-w-0 rounded-md bg-card px-4 text-lg text-navy shadow-card placeholder:text-navy-3",
    "ring-1 ring-inset ring-navy-3/55 transition-shadow duration-200",
    "hover:ring-navy focus:outline-none focus:ring-2 focus:ring-blue",
    bad && "ring-2 ring-bad focus:ring-bad",
  );

function LightField({ id, label, optional, error, children }: { id: string; label: string; optional?: boolean; error?: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-2">
      <label htmlFor={id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-lg font-semibold">
        {label}
        {optional ? <span className="text-base font-normal text-navy-2 lg:text-lg">Optional</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-base font-medium text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
