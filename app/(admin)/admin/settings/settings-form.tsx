"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Badge, Button, Card, NavyPanel } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { formatDuration, formatPence, splitVisitPrice } from "@/lib/money";
import { NOT_SAVED } from "../_lib/errors";
import { saveSettings, type SaveResult } from "./actions";
import { bpsToText, changes, GROUPS, parseSettings, unsetRequired, type Field, type SettingKey, type SettingsRow, type Values } from "./_lib/settings-form";

/**
 * Edit, review, confirm. Typing changes nothing; "Review changes" lists every change as
 * old → new, with what it means (booking switching off, a commission changing meaning),
 * and only "Save these changes" writes. The server checks it all again.
 */
export function SettingsForm({ current, initial, lastChanged }: { current: SettingsRow; initial: Required<Values>; lastChanged: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(initial);
  const [reviewing, setReviewing] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, start] = useTransition();
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  // On a phone the review sits below the form: take the admin (and a screen reader) straight to it.
  useEffect(() => {
    if (!reviewing) return;
    reviewHeading.current?.focus({ preventScroll: true });
    reviewHeading.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [reviewing]);

  const parsed = useMemo(() => parseSettings(values), [values]);
  const diff = useMemo(() => changes(current, parsed.data), [current, parsed]);
  const offAfter = unsetRequired(parsed.data);
  const offNow = unsetRequired(current);
  const errors = reviewing ? {} : { ...parsed.errors, ...serverErrors };

  const update = (key: SettingKey, v: string) => {
    setResult(null);
    setServerErrors((e) => {
      const rest = { ...e };
      delete rest[key]; // never { key: undefined }: that would hide the field's own error
      return rest;
    });
    setValues((old) => {
      const next = { ...old, [key]: v };
      // The value means something else under the other type, so it must be typed again.
      if (key === "commission_type" && v !== old.commission_type) next.commission_value = "";
      return next;
    });
  };

  const save = () =>
    start(async () => {
      let r: SaveResult;
      try {
        r = await saveSettings({ values, expectedUpdatedAt: current.updated_at });
      } catch {
        r = { ok: false, message: NOT_SAVED };
      }
      setResult(r);
      if (r.ok) {
        setReviewing(false);
        router.refresh();
      } else if (r.errors) {
        setServerErrors(r.errors);
        setReviewing(false);
      }
    });

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_26rem] xl:items-start">
      <form
        noValidate
        className="grid gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          setResult(null);
          if (parsed.ok && diff.length) setReviewing(true);
        }}
      >
        {GROUPS.map((g) => (
          <Card key={g.id} className="grid gap-6">
            <div className="grid gap-1.5">
              <h2 className="text-xl font-semibold">{g.title}</h2>
              <p className="max-w-2xl text-navy-2">{g.lede}</p>
            </div>
            <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
              {g.fields.map((f) => (
                <SettingInput key={f.key} field={f} value={values[f.key] ?? ""} error={errors[f.key]} disabled={reviewing || pending}
                  commissionType={values.commission_type ?? ""} onChange={(v) => update(f.key, v)} />
              ))}
            </div>
          </Card>
        ))}

        {!reviewing ? (
          <div className="sticky bottom-0 z-10 -mx-5 flex flex-wrap items-center gap-4 border-t border-line bg-canvas/95 px-5 py-4 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-6">
            <Button type="submit" size="lg" disabled={!parsed.ok || diff.length === 0}>
              Review {diff.length ? `${diff.length} ${diff.length === 1 ? "change" : "changes"}` : "changes"}
            </Button>
            <p className="text-sm text-navy-3">
              {!parsed.ok ? "Fix the boxes marked in red first." : diff.length ? "Nothing is saved until you confirm." : `No changes. Last changed ${lastChanged}.`}
            </p>
            {result ? (
              <p role={result.ok ? "status" : "alert"} className={cn("w-full font-semibold", result.ok ? "text-ok" : "text-bad")}>{result.message}</p>
            ) : null}
          </div>
        ) : null}
      </form>

      <aside className="grid gap-6 xl:sticky xl:top-28">
        {reviewing ? (
          <NavyPanel className="grid gap-5 p-6 pb-16 sm:p-7 sm:pb-16" role="region" aria-labelledby="review-title">
            <h2 id="review-title" ref={reviewHeading} tabIndex={-1} className="scroll-mt-28 text-xl font-semibold">Check before saving</h2>
            <ul className="grid gap-4">
              {diff.map((c) => (
                <li key={c.key} className="grid gap-1 border-b border-line-navy pb-4 last:border-0 last:pb-0">
                  <span className="text-sm text-on-navy-3">{c.label}</span>
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-on-navy-2 line-through decoration-on-navy-3/60">{c.from}</span>
                    <span aria-hidden className="text-teal">→</span>
                    <span className="sr-only">becomes</span>
                    <span className="font-semibold">{c.to}</span>
                  </span>
                </li>
              ))}
            </ul>
            {offAfter.length && !offNow.length ? (
              <p className="rounded-md bg-bad-on-navy/15 px-4 py-3 font-semibold text-bad-on-navy">This switches booking off: {offAfter.map((f) => f.label.toLowerCase()).join(", ")} would be unset.</p>
            ) : offAfter.length ? (
              <p className="rounded-md bg-warn-on-navy/15 px-4 py-3 text-warn-on-navy">Booking stays off until {offAfter.length === 1 ? "this is" : `these ${offAfter.length} are`} set: {offAfter.map((f) => f.label.toLowerCase()).join(", ")}.</p>
            ) : offNow.length ? (
              <p className="rounded-md bg-ok-on-navy/15 px-4 py-3 font-semibold text-ok-on-navy">Every number is set: booking opens as soon as you save.</p>
            ) : null}
            {diff.some((c) => c.key === "price_per_hour_pence" || c.key.startsWith("commission")) ? (
              <p className="text-sm text-on-navy-2">Blocks already booked keep the price and commission they were booked at. This applies to new bookings.</p>
            ) : null}
            {diff.some((c) => c.key === "interest_retention_months") && parsed.data.interest_retention_months === null ? (
              <p className="text-sm text-warn-on-navy">With no retention period, the register-interest form stops taking sign-ups.</p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button variant="signal" size="lg" pending={pending} onClick={save}>Save these changes</Button>
              <Button variant="onNavy" size="lg" disabled={pending} onClick={() => setReviewing(false)}>Back to editing</Button>
            </div>
            {result && !result.ok ? <p role="alert" className="font-semibold text-bad-on-navy">{result.message}</p> : null}
          </NavyPanel>
        ) : null}
        <Example data={parsed.data} errors={parsed.errors} />
      </aside>
    </div>
  );
}

function SettingInput({ field, value, error, disabled, commissionType, onChange }: {
  field: Field; value: string; error?: string; disabled: boolean; commissionType: string; onChange: (v: string) => void;
}) {
  const id = useId();
  const hint = `${id}-hint`;
  const err = `${id}-err`;
  const describedBy = error ? `${hint} ${err}` : hint;

  if (field.unit === "commission_type") {
    return (
      <fieldset className="grid gap-2" aria-describedby={describedBy}>
        <legend className="mb-2 text-sm font-semibold">{field.label}</legend>
        <div className="flex flex-wrap gap-2">
          {([["percent", "A percentage"], ["per_hour", "Per hour"], ["", "Not set"]] as const).map(([v, label]) => (
            <label key={v} className={cn("inline-flex min-h-12 cursor-pointer items-center gap-2.5 rounded-full px-5 ring-1 ring-inset", value === v ? "bg-navy text-on-navy ring-navy" : "bg-card ring-line hover:ring-navy-3", "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue", disabled && "pointer-events-none opacity-60")}>
              <input type="radio" name={field.key} value={v} checked={value === v} disabled={disabled} onChange={() => onChange(v)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
        <p id={hint} className="text-sm text-navy-3">{field.explain}</p>
        {error ? <p id={err} role="alert" className="text-sm font-medium text-bad">{error}</p> : null}
      </fieldset>
    );
  }

  const prefix = field.unit === "pounds" || (field.unit === "commission_value" && commissionType === "per_hour") ? "£" : null;
  const suffix = field.unit === "commission_value" ? (commissionType === "percent" ? "% of the price" : commissionType === "per_hour" ? "per hour cleaned" : null) : field.suffix;
  const wide = field.unit === "districts";

  return (
    <div className={cn("grid content-start gap-2", wide && "md:col-span-2")}>
      <label htmlFor={id} className="text-sm font-semibold">{field.label}</label>
      <div className={cn("flex min-h-14 items-center rounded-md bg-card ring-1 ring-inset ring-line focus-within:ring-2 focus-within:ring-blue", error && "ring-2 ring-bad focus-within:ring-bad", disabled && "opacity-60")}>
        {prefix ? <span className="pl-4 font-semibold text-navy-2" aria-hidden>{prefix}</span> : null}
        <input
          id={id}
          name={field.key}
          value={value}
          disabled={disabled || (field.unit === "commission_value" && !commissionType)}
          inputMode={wide ? "text" : "decimal"}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          className={cn("min-h-14 w-full min-w-0 flex-1 bg-transparent px-4 text-base tabular focus:outline-none", prefix && "pl-1.5")}
        />
        {suffix ? <span className="pr-4 text-sm text-navy-3">{suffix}</span> : null}
        {!value ? <Badge className="mr-3 shrink-0">{field.key === "rebook_first_refusal_minutes" ? "Off" : "Not set"}</Badge> : null}
      </div>
      <p id={hint} className="text-sm text-navy-3">{field.explain}</p>
      {error ? <p id={err} role="alert" className="text-sm font-medium text-bad">{error}</p> : null}
    </div>
  );
}

/** What a customer pays and a cleaner earns, from the numbers on screen, with lib/money's split. */
function Example({ data, errors }: { data: ReturnType<typeof parseSettings>["data"]; errors: Partial<Record<SettingKey, string>> }) {
  const min = data.min_booking_minutes;
  const lengths = min ? Array.from({ length: Math.max(0, Math.floor((600 - min) / 30)) + 1 }, (_, i) => min + i * 30) : [];
  const [chosen, setChosen] = useState<number | null>(null);
  const minutes = chosen && lengths.includes(chosen) ? chosen : (min ?? null);
  const selectId = useId();

  const ready = data.price_per_hour_pence != null && data.commission_type != null && data.commission_value != null && minutes != null
    && !errors.price_per_hour_pence && !errors.commission_value && !errors.min_booking_minutes;
  const split = ready ? splitVisitPrice({ pricePerHourPence: data.price_per_hour_pence!, durationMinutes: minutes!, commissionType: data.commission_type!, commissionValue: data.commission_value! }) : null;

  return (
    <Card className="grid gap-5" role="region" aria-labelledby="example-title">
      <div className="grid gap-1">
        <h2 id="example-title" className="text-lg font-semibold">One clean, worked out</h2>
        <p className="text-sm text-navy-3">From the numbers on screen, before you save. Exact to the penny: the same sum the database uses.</p>
      </div>
      {split && minutes ? (
        <>
          <label htmlFor={selectId} className="grid gap-2 text-sm font-semibold">
            Length of clean
            <select id={selectId} value={minutes} onChange={(e) => setChosen(Number(e.target.value))} className="min-h-12 rounded-md bg-card px-3 text-base font-normal ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-blue">
              {lengths.map((m) => <option key={m} value={m}>{formatDuration(m)}{m === min ? " (the minimum)" : ""}</option>)}
            </select>
          </label>
          <dl className="grid gap-4">
            <div className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
              <dt className="text-navy-2">Customer pays</dt>
              <dd className="font-display text-2xl font-semibold tabular" data-testid="example-price">{formatPence(split.pricePence)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-navy-2">Cleaner earns</dt>
              <dd className="font-display text-2xl font-semibold text-ok tabular" data-testid="example-earnings">{formatPence(split.cleanerEarningsPence)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-navy-2">Ping&rsquo;s fee</dt>
              <dd className="text-lg font-semibold tabular" data-testid="example-fee">{formatPence(split.pingFeePence)}</dd>
            </div>
          </dl>
          {data.late_cancel_fee_pence != null && data.late_cancel_cleaner_share_bps != null ? (
            <p className="rounded-md bg-mist/70 px-4 py-3 text-sm text-navy-2">
              A late cancellation costs the customer {formatPence(data.late_cancel_fee_pence)}, and the cleaner gets {bpsToText(data.late_cancel_cleaner_share_bps)}% of it.
            </p>
          ) : null}
        </>
      ) : (
        <p className="rounded-md bg-mist/70 px-4 py-3 text-navy-2">Set the price, the minimum booking and the commission to see what a customer pays and a cleaner earns.</p>
      )}
    </Card>
  );
}
