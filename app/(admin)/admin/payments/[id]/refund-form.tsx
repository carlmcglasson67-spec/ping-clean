"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { formatPence } from "@/lib/money";
import { NOT_SAVED, type ActionResult } from "../../_lib/errors";
import { refundPayment } from "../actions";
import { parsePounds, previewSplit, reasonsFor, type RefundReason } from "../_lib/payments";

const input = "w-full rounded-md bg-card px-4 py-3 text-base font-normal ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-blue";

/** Amount, why, an optional note for the team, and a plain statement of who carries it. */
export function RefundForm({ payment, cleanerPaid, kind = "visit" }: { payment: { id: string; amount_pence: number; application_fee_pence: number; refunded_pence: number }; cleanerPaid: boolean; kind?: "visit" | "late_cancel" }) {
  const reasons = reasonsFor(kind);
  const router = useRouter();
  const left = payment.amount_pence - payment.refunded_pence;
  const [pounds, setPounds] = useState("");
  const [reason, setReason] = useState<RefundReason | "">("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const amountId = useId();
  const noteId = useId();
  const legendId = useId();

  const pence = parsePounds(pounds);
  const tooMuch = pence !== null && pence > left;
  const chosen = reasons.find((r) => r.value === reason);
  const split = pence !== null && !tooMuch && chosen ? previewSplit(pence, payment, chosen.shared) : null;
  const ready = pence !== null && !tooMuch && !!chosen;

  const send = () =>
    start(async () => {
      let r: ActionResult;
      try {
        r = await refundPayment({ paymentId: payment.id, pounds, reason, note });
      } catch {
        r = { ok: false, message: NOT_SAVED };
      }
      setResult(r);
      if (r.ok) {
        setPounds("");
        setReason("");
        setNote("");
        router.refresh();
      }
    });

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <label htmlFor={amountId} className="text-sm font-semibold">Amount to refund</label>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-44">
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-4 grid place-items-center font-display text-lg font-semibold text-navy-3">£</span>
            <input id={amountId} inputMode="decimal" autoComplete="off" placeholder="0.00" value={pounds}
              onChange={(e) => { setPounds(e.target.value); setResult(null); }}
              aria-invalid={tooMuch || (pounds !== "" && pence === null)}
              className={cn(input, "pl-9 font-display text-lg font-semibold tabular")} />
          </div>
          <button type="button" onClick={() => { setPounds(`${Math.floor(left / 100)}.${String(left % 100).padStart(2, "0")}`); setResult(null); }}
            className="min-h-12 rounded-md px-4 text-sm font-semibold text-navy underline decoration-line decoration-2 underline-offset-4 hover:decoration-navy">
            All of it: {formatPence(left)}
          </button>
        </div>
        {tooMuch ? <p role="alert" className="text-sm font-semibold text-bad">Only {formatPence(left)} is left to refund.</p>
          : pounds !== "" && pence === null ? <p role="alert" className="text-sm font-semibold text-bad">Type pounds and pence, like 12.50.</p> : null}
      </div>

      <fieldset aria-labelledby={legendId} className="grid gap-3">
        <legend id={legendId} className="text-sm font-semibold">Why?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {reasons.map((r) => (
            <label key={r.value} className={cn(
              "grid min-h-16 cursor-pointer content-center gap-0.5 rounded-md px-4 py-3 ring-1 ring-inset transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue",
              reason === r.value ? "bg-navy text-on-navy ring-navy" : "bg-card ring-line hover:ring-navy-3",
            )}>
              <input type="radio" name={`reason-${payment.id}`} value={r.value} checked={reason === r.value} onChange={() => { setReason(r.value); setResult(null); }} className="sr-only" />
              <span className="font-semibold">{r.label}</span>
              <span className={cn("text-sm", reason === r.value ? "text-on-navy/80" : "text-navy-2")}>{r.shared ? "Shared by the cleaner and Ping" : "Ping carries all of it"}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label htmlFor={noteId} className="grid gap-2 text-sm font-semibold">
        Note for the team (optional; the customer and the cleaner never see it)
        <textarea id={noteId} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={input} />
      </label>

      {split ? (
        <dl data-refund-preview className="grid gap-3 rounded-md bg-mist p-5 sm:grid-cols-3">
          <div className="grid gap-1"><dt className="text-sm text-navy-2">Back to the customer</dt><dd className="font-display text-xl font-semibold tabular">{formatPence(pence!)}</dd></div>
          <div className="grid gap-1"><dt className="text-sm text-navy-2">From the cleaner</dt><dd className="font-display text-xl font-semibold tabular" data-part="cleaner">{formatPence(split.cleaner)}</dd></div>
          <div className="grid gap-1"><dt className="text-sm text-navy-2">From Ping</dt><dd className="font-display text-xl font-semibold tabular" data-part="ping">{formatPence(split.ping)}</dd></div>
          {split.cleaner > 0 && cleanerPaid ? (
            <p className="text-sm text-navy-2 sm:col-span-3">The cleaner has already been paid {kind === "late_cancel" ? "their part of this fee" : "for this clean"}, so Stripe takes their part from their next earnings.</p>
          ) : null}
        </dl>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Button pending={pending} disabled={!ready} onClick={send}>{ready ? `Refund ${formatPence(pence!)}` : "Refund"}</Button>
        {result ? <p role={result.ok ? "status" : "alert"} className={cn("text-sm font-semibold", result.ok ? "text-ok" : "text-bad")}>{result.message}</p> : null}
      </div>
      <p className="text-sm text-navy-3">A refund can&rsquo;t be undone once it&rsquo;s sent.</p>
    </div>
  );
}
