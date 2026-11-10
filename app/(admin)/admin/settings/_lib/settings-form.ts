import { formatDuration, formatPence } from "@/lib/money";
import type { Tables } from "@/lib/db/types";

/**
 * The settings screen's fields: how each is typed in, checked and shown. Used by the page
 * (to review changes before saving) and by the Server Action (which checks everything
 * again; the browser is never trusted). Money is parsed from text straight into whole pence
 * with integer maths, never through a float. An empty field means "not set" (NULL): Ping
 * never fills in or suggests a number.
 */

export type SettingsRow = Tables<"settings">;
export type SettingKey = Exclude<keyof SettingsRow, "id" | "updated_at">;
export type Values = Partial<Record<SettingKey, string>>;
type Parsed = SettingsRow[SettingKey];

type Unit = "pounds" | "half_hours" | "minutes" | "hours" | "percent" | "months" | "districts" | "commission_type" | "commission_value"
  | "late_cancel_split";

/** Fields picked from a short list, with the values the database's check allows ("" = not set). */
export const CHOICES = {
  commission_type: [["percent", "A percentage"], ["per_hour", "Per hour"], ["", "Not set"]],
  late_cancel_split: [["same_as_clean", "Same split as a clean"], ["fixed_share", "A fixed share"], ["", "Not set"]],
} as const satisfies Partial<Record<Unit, readonly (readonly [string, string])[]>>;
type ChoiceUnit = keyof typeof CHOICES;
export const isChoice = (u: Unit): u is ChoiceUnit => u in CHOICES;

export type Field = {
  key: SettingKey;
  label: string;
  unit: Unit;
  explain: string;
  /** Booking can't open while this is unset (private.settings_ready()). */
  required?: boolean;
  /** What the input box is followed by: "£", "hours"… */
  suffix?: string;
  /** The most it can sensibly be (minutes and hours fields). Chosen by Track C, listed in the PR for Carl. */
  max?: number;
};

export type Group = { id: string; title: string; lede: string; fields: Field[] };

export const GROUPS: Group[] = [
  {
    id: "price",
    title: "Price",
    lede: "What a customer pays. Fixed by Ping; cleaners can't change it. A booking keeps the price it was made at, so a change here only affects new bookings.",
    fields: [
      { key: "price_per_hour_pence", label: "Customer price per hour", unit: "pounds", required: true, suffix: "an hour",
        explain: "Charged for every hour of a clean, after the clean is done." },
      { key: "min_booking_minutes", label: "Minimum booking", unit: "half_hours", required: true, suffix: "hours",
        explain: "The shortest clean a customer can book. Whole or half hours, at least 1 hour and at most 10." },
    ],
  },
  {
    id: "commission",
    title: "Ping's commission",
    lede: "Ping's fee comes out of the price. The cleaner gets the rest. Stored separately on every visit.",
    fields: [
      { key: "commission_type", label: "Commission is", unit: "commission_type", required: true,
        explain: "A percentage of the price, or a fixed amount for every hour cleaned." },
      { key: "commission_value", label: "Commission", unit: "commission_value", required: true,
        explain: "Changing between percentage and per hour clears this, so it's always typed in for the right one." },
    ],
  },
  {
    id: "offers",
    title: "Offering jobs",
    lede: "A new block goes to Top cleaners first, then Approved, then everyone. These are the waits between.",
    fields: [
      { key: "top_window_minutes", label: "Top cleaners only, for", unit: "minutes", required: true, suffix: "minutes", max: 10_080,
        explain: "How long only Top-tier cleaners see a new job." },
      { key: "approved_window_minutes", label: "Then Top and Approved, for", unit: "minutes", required: true, suffix: "minutes", max: 10_080,
        explain: "After that window, how long until every approved cleaner, New tier included, can see it." },
      { key: "unclaimed_alert_minutes", label: "Alert me if nobody claims it within", unit: "minutes", required: true, suffix: "minutes more", max: 10_080,
        explain: "Counted after both windows. Then it's marked unclaimed and appears in Jobs for you to assign." },
      { key: "rebook_first_refusal_minutes", label: "Previous cleaner gets a rebook first, for", unit: "minutes", suffix: "minutes", max: 20_160,
        explain: "When a customer books again, the cleaner who did their last block sees it first. Empty means off: rebooks go straight to everyone." },
    ],
  },
  {
    id: "cancel",
    title: "Cancellations and payouts",
    lede: "What happens when a customer cancels late, and how long Ping holds a cleaner's pay in case of a complaint.",
    fields: [
      { key: "cancel_notice_hours", label: "Free cancellation up to", unit: "hours", suffix: "hours before", max: 168,
        explain: "A customer who cancels with less notice than this pays the late fee." },
      { key: "late_cancel_fee_pence", label: "Late cancellation fee", unit: "pounds",
        explain: "Charged to the customer for a late cancellation." },
      { key: "late_cancel_split", label: "Cleaner's share of that fee", unit: "late_cancel_split",
        explain: "The same split as a normal clean (the cleaner keeps what they'd earn, Ping keeps its commission), or a fixed share you set." },
      { key: "late_cancel_cleaner_share_bps", label: "Fixed share for the cleaner", unit: "percent", suffix: "% of the fee",
        explain: "The part of the late fee that goes to the cleaner who lost the work." },
      { key: "dispute_window_hours", label: "Hold a cleaner's pay for", unit: "hours", required: true, suffix: "hours after the clean", max: 720,
        explain: "Time for the customer to raise a problem before the cleaner is paid." },
    ],
  },
  {
    id: "areas",
    title: "Where Ping works",
    lede: "Booking only opens for homes in these postcode districts.",
    fields: [
      { key: "launch_districts", label: "Launch postcode districts", unit: "districts", required: true,
        explain: "Separate with commas, like the start of a postcode: CA14, CA28." },
      { key: "interest_retention_months", label: "Keep register-interest sign-ups for", unit: "months", suffix: "months",
        explain: "Quoted in the sign-up wording. Between 1 and 24. Empty stops new sign-ups." },
    ],
  },
];

export const FIELDS: Field[] = GROUPS.flatMap((g) => g.fields);
const FIELD = new Map(FIELDS.map((f) => [f.key, f]));

/** Whether a field applies, given the other values: the fixed share only with a fixed split. */
export function isShown(f: Field, values: Values): boolean {
  return f.key !== "late_cancel_cleaner_share_bps" || values.late_cancel_split === "fixed_share";
}

/** A field's upper limit as people say it: "7 days", "30 days". */
export function limitInWords(f: Field): string {
  if (f.max === undefined) return "";
  const hours = f.unit === "minutes" ? f.max / 60 : f.max;
  return hours % 24 === 0 ? `${hours / 24} days` : `${hours} hours`;
}

// ------------------------------------------------------------------ to the form

/** 2250 → "22.50". Whole pence in, the text an admin would type. Integer maths only. */
export function penceToText(p: number): string {
  return `${Math.floor(p / 100)}.${String(p % 100).padStart(2, "0")}`;
}

/** 2500 → "25", 1250 → "12.5", 1205 → "12.05". */
export function bpsToText(bps: number): string {
  const frac = bps % 100;
  return frac === 0 ? `${Math.floor(bps / 100)}` : `${Math.floor(bps / 100)}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** The saved row as the text in each box. Unset is an empty box. */
export function toValues(row: SettingsRow): Required<Values> {
  const out = {} as Required<Values>;
  for (const f of FIELDS) {
    const v = row[f.key];
    out[f.key] = v === null || v === undefined ? "" : toText(f, v, row.commission_type);
  }
  return out;
}

function toText(f: Field, v: NonNullable<Parsed>, commissionType: SettingsRow["commission_type"]): string {
  switch (f.unit) {
    case "pounds":
      return penceToText(v as number);
    case "half_hours":
      return `${Math.floor((v as number) / 60)}${(v as number) % 60 ? ".5" : ""}`;
    case "percent":
      return bpsToText(v as number);
    case "districts":
      return (v as string[]).join(", ");
    case "commission_value":
      return commissionType === "percent" ? bpsToText(v as number) : penceToText(v as number);
    default:
      return String(v);
  }
}

// ------------------------------------------------------------------ from the form

const POUNDS = /^£?\s*(\d{1,4})(?:\.(\d{1,2}))?$/;
const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?\s*%?$/;
const WHOLE = /^\d{1,6}$/;
const DISTRICT = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;

function pounds(t: string): number | null {
  const m = POUNDS.exec(t);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

function percentBps(t: string): number | null {
  const m = PERCENT.exec(t);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

export type SettingsData = { [K in SettingKey]: SettingsRow[K] };
/** data holds every field that parsed (a field with an error is left out); ok only when none failed. */
export type ParseResult = { ok: boolean; data: SettingsData; errors: Partial<Record<SettingKey, string>> };

/** Every field, checked as the database would (and a little stricter, where a value would make no sense). */
export function parseSettings(values: Values): ParseResult {
  const errors: Partial<Record<SettingKey, string>> = {};
  const data = {} as { [K in SettingKey]: SettingsRow[K] };
  const set = <K extends SettingKey>(k: K, v: SettingsRow[K]) => { data[k] = v; };
  const text = (k: SettingKey) => (values[k] ?? "").trim();

  const commissionType = text("commission_type");
  if (commissionType !== "" && commissionType !== "percent" && commissionType !== "per_hour") errors.commission_type = "Choose percentage or per hour.";
  set("commission_type", commissionType === "percent" || commissionType === "per_hour" ? commissionType : null);

  const split = text("late_cancel_split");
  if (split !== "" && split !== "same_as_clean" && split !== "fixed_share") errors.late_cancel_split = "Choose the same split as a clean, or a fixed share.";
  set("late_cancel_split", split === "same_as_clean" || split === "fixed_share" ? split : null);

  for (const f of FIELDS) {
    if (f.unit === "commission_type" || f.unit === "late_cancel_split") continue;
    // A fixed share only means something with a fixed split; otherwise it's cleared (the
    // database refuses a share alongside "same split as a clean").
    if (f.key === "late_cancel_cleaner_share_bps" && data.late_cancel_split !== "fixed_share") {
      set(f.key, null);
      continue;
    }
    const t = text(f.key);
    if (t === "") {
      set(f.key, (f.unit === "districts" ? [] : null) as never);
      continue;
    }
    let v: Parsed = null;
    let err: string | null = null;
    switch (f.unit) {
      case "pounds":
        v = pounds(t);
        if (v === null) err = "Enter pounds and pence.";
        else if (f.key === "price_per_hour_pence" && v === 0) err = "The price has to be more than £0.";
        break;
      case "half_hours": {
        const m = /^(\d{1,2})(?:\.(5|50|0|00))?$/.exec(t);
        v = m ? Number(m[1]) * 60 + (m[2]?.startsWith("5") ? 30 : 0) : null;
        if (v === null || v < 60 || v > 600) { err = "Whole or half hours, from 1 to 10."; v = null; }
        break;
      }
      case "minutes":
      case "hours":
        v = WHOLE.test(t) ? Number(t) : null;
        if (v === null) err = `A whole number of ${f.unit}.`;
        else if (f.key === "unclaimed_alert_minutes" && v === 0) err = "At least 1 minute.";
        else if (f.key === "rebook_first_refusal_minutes" && v === 0) err = "At least 1 minute, or leave it empty to switch it off.";
        else if (f.max !== undefined && v > f.max) err = `At most ${f.max.toLocaleString("en-GB")} ${f.unit} (${limitInWords(f)}).`;
        break;
      case "percent":
        v = percentBps(t);
        if (v === null) err = "A percentage from 0 to 100.";
        break;
      case "months":
        v = WHOLE.test(t) ? Number(t) : null;
        if (v === null || v < 1 || v > 24) { err = "A whole number of months, 1 to 24."; v = null; }
        break;
      case "districts": {
        const list = [...new Set(t.toUpperCase().split(/[\s,]+/).filter(Boolean))];
        const bad = list.filter((d) => !DISTRICT.test(d));
        if (bad.length) err = `Not a postcode district: ${bad.join(", ")}. Use the first half of a postcode, like CA14.`;
        else if (list.length > 60) err = "That's more districts than Ping can hold (60).";
        v = bad.length ? null : list;
        break;
      }
      case "commission_value":
        if (!data.commission_type) err = "Choose percentage or per hour first.";
        else if (data.commission_type === "percent") {
          v = percentBps(t);
          if (v === null) err = "A percentage from 0 to 100.";
          else if (v >= 10_000) err = "At 100% the cleaner would earn nothing.";
        } else {
          v = pounds(t);
          if (v === null) err = "Enter pounds and pence an hour.";
        }
        break;
    }
    if (err) errors[f.key] = err;
    else set(f.key, v as never);
  }

  // A fixed split needs its share.
  if (data.late_cancel_split === "fixed_share" && data.late_cancel_cleaner_share_bps == null && !errors.late_cancel_cleaner_share_bps) {
    errors.late_cancel_cleaner_share_bps = "Type the cleaner's share, or choose the same split as a clean.";
  }
  // Both halves of the commission, or neither.
  if (data.commission_type && (data.commission_value === null || data.commission_value === undefined) && !errors.commission_value) {
    errors.commission_value = "Type the commission, or clear the type too.";
  }
  // A per-hour fee at or above the hourly price leaves the cleaner nothing.
  if (data.commission_type === "per_hour" && data.commission_value != null && data.price_per_hour_pence != null
      && data.commission_value >= data.price_per_hour_pence && !errors.commission_value) {
    errors.commission_value = "That's the whole hourly price or more: the cleaner would earn nothing.";
  }
  return { ok: Object.keys(errors).length === 0, data, errors };
}

// ------------------------------------------------------------------ reviewing a change

/** A value as a person reads it: "£22.50 an hour", "2½ hours", "Not set". */
export function describe(key: SettingKey, v: Parsed, commissionType: SettingsRow["commission_type"]): string {
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) {
    return key === "rebook_first_refusal_minutes" ? "Off" : "Not set";
  }
  const f = FIELD.get(key)!;
  const n = v as number;
  switch (f.unit) {
    case "pounds":
      return key === "price_per_hour_pence" ? `${formatPence(n)} an hour` : formatPence(n);
    case "half_hours":
      return formatDuration(n);
    case "minutes":
      return n % 60 === 0 && n > 0 ? `${n} minutes (${n / 60} ${n === 60 ? "hour" : "hours"})` : `${n} minutes`;
    case "hours":
      return `${n} ${n === 1 ? "hour" : "hours"}`;
    case "percent":
      return `${bpsToText(n)}%`;
    case "months":
      return `${n} ${n === 1 ? "month" : "months"}`;
    case "districts":
      return (v as string[]).join(", ");
    case "commission_type":
      return v === "percent" ? "A percentage of the price" : "A fixed amount per hour";
    case "late_cancel_split":
      return v === "same_as_clean" ? "The same split as a clean" : "A fixed share";
    case "commission_value":
      return commissionType === "percent" ? `${bpsToText(n)}% of the price` : `${formatPence(n)} per hour cleaned`;
  }
}

export type Change = { key: SettingKey; label: string; from: string; to: string };

export function changes(current: SettingsRow, next: { [K in SettingKey]: SettingsRow[K] }): Change[] {
  const out: Change[] = [];
  for (const f of FIELDS) {
    const a = current[f.key];
    const b = next[f.key];
    const same = Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a ?? []) === JSON.stringify(b ?? []) : (a ?? null) === (b ?? null);
    // The value's meaning depends on the type, so a type change always shows the value too.
    const typeMoved = f.key === "commission_value" && current.commission_type !== next.commission_type;
    if (same && !typeMoved) continue;
    out.push({
      key: f.key,
      label: f.label,
      from: describe(f.key, a, current.commission_type),
      to: describe(f.key, b, next.commission_type),
    });
  }
  return out;
}

/** Which required numbers would be unset after the change: booking switches off while any are. */
export function unsetRequired(next: { [K in SettingKey]: SettingsRow[K] }): Field[] {
  return FIELDS.filter((f) => f.required && (next[f.key] === null || (Array.isArray(next[f.key]) && (next[f.key] as string[]).length === 0)));
}
