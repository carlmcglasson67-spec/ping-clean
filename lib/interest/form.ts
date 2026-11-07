// Register interest: the form's fields, wording and checks. Safe to import anywhere,
// including the client form. The database re-checks everything in public.register_interest.
import { z } from "zod";

/** Where the form is shown. The database only accepts these. */
export const INTEREST_SOURCES = ["instant_price", "holding_page"] as const;
export type InterestSource = (typeof INTEREST_SOURCES)[number];

/**
 * The consent wording's version, stored with every row. Change it whenever the wording
 * below changes. Draft until Carl and Kate approve it.
 */
export const INTEREST_CONSENT_VERSION = "draft-2026-11";

/** The tick box label. It must be ticked: unticked, nothing is stored (Carl, 7 Nov 2026). */
export const INTEREST_NOTIFY_LABEL = "Tell me when booking opens near me";

/**
 * The wording under the form (draft for Carl and Kate). `months` comes from
 * settings.interest_retention_months, via interestFormSetup() — never typed in.
 */
export function interestConsentText(months: number): string {
  return (
    "We'll use this only to send you one message when booking opens near you. " +
    `We delete it after ${months} months, or sooner if you ask us. ` +
    "We never share or sell it."
  );
}

/** The form's field names. The honeypot and Turnstile names are fixed. */
export const INTEREST_FIELDS = {
  postcode: "postcode",
  contact: "contact", // "email" | "phone": which one they chose
  email: "email",
  phone: "phone",
  notify: "notify", // checkbox, value "on"
  source: "source", // hidden: one of INTEREST_SOURCES
  honeypot: "company", // hidden from people; bots fill it in
  turnstile: "cf-turnstile-response", // added by the Turnstile widget
} as const;

export type InterestField = "postcode" | "email" | "phone" | "notify" | "captcha";

export type InterestValues = { postcode: string; contact: "email" | "phone"; email: string; phone: string; notify: boolean };

/** What registerInterest returns, for useActionState. */
export type RegisterInterestState =
  | { status: "idle" }
  | { status: "thanks" }
  | {
      status: "error";
      /** A message for the whole form (e.g. "try again"), if any. */
      message?: string;
      /** A message per field, to show next to it. */
      fieldErrors?: Partial<Record<InterestField, string>>;
      /** What they typed, to put back in the fields. */
      values: InterestValues;
    };

export const initialInterestState: RegisterInterestState = { status: "idle" };

// ---------------------------------------------------------------- normalising
// Mirrors private.normalise_* in the migration, so the form says the same as the database.

/** "ca14 3xx", "CA143XX" → "CA14 3XX". Null if it isn't a UK postcode shape. */
export function normalisePostcode(raw: string): string | null {
  const t = raw.replace(/\s/g, "").toUpperCase();
  return /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/.test(t) ? `${t.slice(0, -3)} ${t.slice(-3)}` : null;
}

/** "07700 900321", "+44 7700 900321" → "+447700900321". UK mobiles only. */
export function normaliseUkMobile(raw: string): string | null {
  const t = raw.replace(/[\s().-]/g, "");
  if (/^07[0-9]{9}$/.test(t)) return `+44${t.slice(1)}`;
  if (/^447[0-9]{9}$/.test(t)) return `+${t}`;
  if (/^\+447[0-9]{9}$/.test(t)) return t;
  return null;
}

/** Lower-cased and trimmed. Null if it isn't a plain address. */
export function normaliseEmail(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  return t.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t) ? t : null;
}

// ---------------------------------------------------------------- parsing
const text = (max: number) => z.string().max(max).catch("");

const formShape = z.object({
  postcode: text(16),
  contact: z.enum(["email", "phone"]).catch("email"),
  email: text(320),
  phone: text(32),
  notify: z.literal("on").optional().catch(undefined),
  source: z.enum(INTEREST_SOURCES).optional().catch(undefined),
});

export type InterestArgs = {
  p_postcode: string;
  p_email: string | null;
  p_phone: string | null;
  p_notify: true;
  p_source: InterestSource;
  p_consent_version: string;
};

export type ParsedInterest =
  | { ok: true; args: InterestArgs; values: InterestValues }
  | { ok: false; fieldErrors: Partial<Record<InterestField, string>>; values: InterestValues; badSource?: boolean };

const get = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

/** Checks the form on the server. Only the chosen contact is kept; the other is dropped. */
export function parseInterestForm(fd: FormData): ParsedInterest {
  const f = formShape.parse({
    postcode: get(fd, INTEREST_FIELDS.postcode),
    contact: get(fd, INTEREST_FIELDS.contact),
    email: get(fd, INTEREST_FIELDS.email),
    phone: get(fd, INTEREST_FIELDS.phone),
    notify: get(fd, INTEREST_FIELDS.notify),
    source: get(fd, INTEREST_FIELDS.source),
  });
  const values: InterestValues = { postcode: f.postcode, contact: f.contact, email: f.email, phone: f.phone, notify: f.notify === "on" };
  const fieldErrors: Partial<Record<InterestField, string>> = {};

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

  if (!values.notify) fieldErrors.notify = `Tick “${INTEREST_NOTIFY_LABEL}” so we can let you know.`;

  if (Object.keys(fieldErrors).length > 0 || !f.source) {
    return { ok: false, fieldErrors, values, badSource: !f.source };
  }
  return {
    ok: true,
    values,
    args: { p_postcode: postcode!, p_email: email, p_phone: phone, p_notify: true, p_source: f.source, p_consent_version: INTEREST_CONSENT_VERSION },
  };
}
