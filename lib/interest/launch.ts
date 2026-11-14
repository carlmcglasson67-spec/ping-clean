// The /launch form: register interest as a customer or as a would-be cleaner, then a few
// short, optional questions. Safe to import anywhere, including the client form and the
// admin console (which uses the labels). The database re-checks the shape in
// public.register_launch_interest; this file is the only place the questions live.
//
// Carl's 7 Nov rules all hold: email OR UK mobile, the tick is required, the reply is
// always the same. Carl, 14 Nov 2026: cleaners register too, and both answer a few
// questions that help plan the launch (intent/launch-interest/plan.md).
import { z } from "zod";
import { INTEREST_FIELDS, normaliseEmail, normalisePostcode, normaliseUkMobile } from "./form";

export const LAUNCH_KINDS = ["customer", "cleaner"] as const;
export type LaunchKind = (typeof LAUNCH_KINDS)[number];

/** Stored with every row. Change it whenever the wording below changes. Draft until Carl and Kate approve it. */
export const LAUNCH_CONSENT_VERSION = "launch-draft-2026-11";

/** The tick box. It must be ticked: unticked, nothing is stored. */
export const LAUNCH_NOTIFY_LABEL: Record<LaunchKind, string> = {
  customer: "Tell me when booking opens near me",
  cleaner: "Tell me when Ping is taking on cleaners near me",
};

/** The wording under the form (draft for Carl and Kate). `months` comes from settings, never typed in. */
export function launchConsentText(kind: LaunchKind, months: number): string {
  return (
    (kind === "customer"
      ? "We’ll use this to send you one message when booking opens near you, "
      : "We’ll use this to send you one message when we’re taking on cleaners near you, ") +
    "and to help us plan the launch. " +
    `We delete it after ${months} months, or sooner if you ask us. ` +
    "We never share or sell it."
  );
}

// ---------------------------------------------------------------- the questions
export type LaunchOption = { value: string; label: string };
export type LaunchQuestion = {
  /** The key the answer is stored under. Lower-case letters and underscores. */
  key: string;
  label: string;
  /** "one": pick one. "many": pick any, up to `max`. */
  pick: "one" | "many";
  max?: number;
  options: LaunchOption[];
};

const o = (value: string, label: string): LaunchOption => ({ value, label });

/** Every question is optional. Order here is the order on the page and in the admin console. */
export const LAUNCH_QUESTIONS: Record<LaunchKind, LaunchQuestion[]> = {
  customer: [
    { key: "frequency", label: "How often would you want a clean?", pick: "one",
      options: [o("weekly", "Every week"), o("fortnightly", "Every two weeks"), o("unsure", "Not sure yet")] },
    { key: "bedrooms", label: "How many bedrooms?", pick: "one",
      options: [o("1", "1"), o("2", "2"), o("3", "3"), o("4", "4"), o("5_plus", "5 or more")] },
    { key: "has_cleaner", label: "Do you have a cleaner at the moment?", pick: "one",
      options: [o("yes_would_change", "Yes, but I’d change"), o("used_to", "I used to"), o("never", "Never had one")] },
    { key: "priorities", label: "What matters most to you?", pick: "many", max: 3,
      options: [o("same_cleaner", "The same cleaner each time"), o("reliable", "Turning up when they say"),
        o("checked", "Knowing they’ve been checked"), o("proof", "Proof it’s been done"),
        o("easy_booking", "Easy to book and pay"), o("no_contract", "No contract")] },
    { key: "start", label: "When would you want to start?", pick: "one",
      options: [o("at_launch", "As soon as you launch"), o("few_months", "In the next few months"), o("just_looking", "Just looking for now")] },
  ],
  cleaner: [
    { key: "experience", label: "How much cleaning experience do you have?", pick: "one",
      options: [o("new", "New to it"), o("under_1", "Under a year"), o("1_to_3", "1 to 3 years"), o("over_3", "More than 3 years")] },
    { key: "current_work", label: "What are you doing now?", pick: "one",
      options: [o("self_employed", "Self-employed, my own customers"), o("employed", "Cleaning for a company"), o("not_cleaning", "Not cleaning at the moment")] },
    { key: "hours", label: "How many hours a week would you like?", pick: "one",
      options: [o("under_8", "Under 8"), o("8_to_16", "8 to 16"), o("16_to_30", "16 to 30"), o("over_30", "More than 30")] },
    { key: "availability", label: "When can you work?", pick: "many", max: 4,
      options: [o("weekday_mornings", "Weekday mornings"), o("weekday_afternoons", "Weekday afternoons"), o("evenings", "Evenings"), o("weekends", "Weekends")] },
    { key: "drives", label: "Do you drive and have your own transport?", pick: "one",
      options: [o("yes", "Yes"), o("no", "No")] },
    { key: "priorities", label: "What matters most to you in cleaning work?", pick: "many", max: 3,
      options: [o("own_hours", "Choosing my own hours"), o("paid_on_time", "Being paid on time"), o("close_to_home", "Work close to home"),
        o("regulars", "Regular customers"), o("see_pay_first", "Seeing the pay before I say yes"), o("own_boss", "Being my own boss")] },
  ],
};

/** The one free-text question, stored under "note". Optional. */
export const LAUNCH_NOTE: Record<LaunchKind, { label: string; placeholder: string }> = {
  customer: { label: "What has let you down about cleaners or agencies before?", placeholder: "Tell us, and we’ll build Ping to fix it." },
  cleaner: { label: "What would make this the best cleaning work you’ve had?", placeholder: "Be honest. We clean for a living too." },
};
export const LAUNCH_NOTE_MAX = 500;
export const LAUNCH_NAME_MAX = 60;

/** Field names. Contact fields are shared with the first register-interest form. */
export const LAUNCH_FIELDS = {
  ...INTEREST_FIELDS,
  kind: "kind",
  firstName: "first_name",
  note: "note",
  /** A question's field name: its options are sent as repeated values. */
  answer: (key: string) => `a_${key}`,
} as const;

export type LaunchAnswers = Record<string, string | string[]>;

/** "weekly" → "Every week". Falls back to the stored key for a question that has since changed. */
export function launchAnswerLabel(kind: LaunchKind, question: string, value: string): string {
  return LAUNCH_QUESTIONS[kind].find((q) => q.key === question)?.options.find((x) => x.value === value)?.label ?? value;
}
export function launchQuestionLabel(kind: LaunchKind, question: string): string {
  return LAUNCH_QUESTIONS[kind].find((q) => q.key === question)?.label ?? question;
}

// ---------------------------------------------------------------- form state
export type LaunchField = "postcode" | "email" | "phone" | "notify" | "captcha" | "firstName" | "note";

export type LaunchValues = {
  kind: LaunchKind;
  firstName: string;
  postcode: string;
  contact: "email" | "phone";
  email: string;
  phone: string;
  notify: boolean;
  /** Chosen option values per question key. */
  answers: Record<string, string[]>;
  note: string;
};

export type LaunchInterestState =
  | { status: "idle" }
  | { status: "thanks"; kind: LaunchKind }
  | { status: "error"; message?: string; fieldErrors?: Partial<Record<LaunchField, string>>; values: LaunchValues };

export const initialLaunchState: LaunchInterestState = { status: "idle" };

// ---------------------------------------------------------------- parsing
export type LaunchArgs = {
  p_kind: LaunchKind;
  p_first_name: string | null;
  p_postcode: string;
  p_email: string | null;
  p_phone: string | null;
  p_notify: true;
  p_consent_version: string;
  p_answers: LaunchAnswers;
};

export type ParsedLaunch =
  | { ok: true; args: LaunchArgs; values: LaunchValues }
  | { ok: false; fieldErrors: Partial<Record<LaunchField, string>>; values: LaunchValues };

const text = (max: number) => z.string().max(max).catch("");
// Longer than anything the page can send (its fields have maxLength). Kept, cut to this
// length, so an over-long name or note gets its own message instead of vanishing.
const cut = (max: number) => z.string().catch("").transform((v) => v.slice(0, max));
const shape = z.object({
  kind: z.enum(LAUNCH_KINDS).catch("customer"),
  firstName: cut(200),
  postcode: text(16),
  contact: z.enum(["email", "phone"]).catch("email"),
  email: text(320),
  phone: text(32),
  notify: z.literal("on").optional().catch(undefined),
  note: cut(4000),
});

const NAME = /^\p{L}[\p{L} '’-]*$/u;
// Control characters other than tab, new line and carriage return.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const get = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

/**
 * Checks the form on the server. Only the chosen contact is kept. An answer is kept only
 * when it is one of that question's real options, so nothing the browser invents is stored.
 * The consent version comes from here, never from the form.
 */
export function parseLaunchForm(fd: FormData): ParsedLaunch {
  const f = shape.parse({
    kind: get(fd, LAUNCH_FIELDS.kind),
    firstName: get(fd, LAUNCH_FIELDS.firstName),
    postcode: get(fd, LAUNCH_FIELDS.postcode),
    contact: get(fd, LAUNCH_FIELDS.contact),
    email: get(fd, LAUNCH_FIELDS.email),
    phone: get(fd, LAUNCH_FIELDS.phone),
    notify: get(fd, LAUNCH_FIELDS.notify),
    note: get(fd, LAUNCH_FIELDS.note),
  });

  const chosen: Record<string, string[]> = {};
  const answers: LaunchAnswers = {};
  for (const q of LAUNCH_QUESTIONS[f.kind]) {
    const allowed = new Set(q.options.map((x) => x.value));
    const picked = [...new Set(fd.getAll(LAUNCH_FIELDS.answer(q.key)).filter((v): v is string => typeof v === "string" && allowed.has(v)))];
    const kept = q.pick === "one" ? picked.slice(0, 1) : picked.slice(0, q.max ?? q.options.length);
    if (kept.length === 0) continue;
    chosen[q.key] = kept;
    answers[q.key] = q.pick === "one" ? kept[0]! : kept;
  }

  const values: LaunchValues = {
    kind: f.kind, firstName: f.firstName, postcode: f.postcode, contact: f.contact,
    email: f.email, phone: f.phone, notify: f.notify === "on", answers: chosen, note: f.note,
  };
  const fieldErrors: Partial<Record<LaunchField, string>> = {};

  const firstName = f.firstName.trim().replace(/\s+/g, " ");
  if (firstName && (firstName.length > LAUNCH_NAME_MAX || !NAME.test(firstName))) {
    fieldErrors.firstName = "Just your first name, in letters.";
  }

  const postcode = normalisePostcode(f.postcode);
  if (!f.postcode.trim()) fieldErrors.postcode = "Enter your postcode.";
  else if (!postcode) fieldErrors.postcode = "Enter a full UK postcode, like CA14 3XX.";

  let email: string | null = null;
  let phone: string | null = null;
  if (f.contact === "email") {
    email = normaliseEmail(f.email);
    if (!f.email.trim()) fieldErrors.email = "Enter your email address.";
    else if (!email) fieldErrors.email = "Enter an email address like name@example.com.";
  } else {
    phone = normaliseUkMobile(f.phone);
    if (!f.phone.trim()) fieldErrors.phone = "Enter your mobile number.";
    else if (!phone) fieldErrors.phone = "Enter a UK mobile number, like 07700 900123.";
  }

  const note = f.note.replace(/\r\n?/g, "\n").trim();
  if (note.length > LAUNCH_NOTE_MAX) fieldErrors.note = `Keep it under ${LAUNCH_NOTE_MAX} characters.`;
  else if (CONTROL.test(note)) fieldErrors.note = "Plain text only, please.";
  else if (note) answers.note = note;

  if (!values.notify) fieldErrors.notify = `Tick “${LAUNCH_NOTIFY_LABEL[f.kind]}” so we can let you know.`;

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, values };
  return {
    ok: true,
    values,
    args: {
      p_kind: f.kind, p_first_name: firstName || null, p_postcode: postcode!, p_email: email, p_phone: phone,
      p_notify: true, p_consent_version: LAUNCH_CONSENT_VERSION, p_answers: answers,
    },
  };
}
