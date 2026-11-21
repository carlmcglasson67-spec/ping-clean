"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { NOT_SAVED, type ActionResult } from "../_lib/errors";
import { assignBlock, endBlock, reopenBlock, resolveAlert, settleClean } from "./actions";

export type CleanerOption = { id: string; label: string; fits: boolean };
type Mode = "assign" | "reopen" | "end" | null;

function useRun() {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      let r: ActionResult;
      try {
        r = await fn();
      } catch {
        r = { ok: false, message: NOT_SAVED };
      }
      setResult(r);
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });
  return { result, setResult, pending, run };
}

/**
 * The block's actions. Each opens a confirm step that says exactly what will happen, and
 * nothing is sent until the second tap. End needs a reason (it's kept on the block).
 */
export function BlockActions({ seriesId, held, cleaners, summary }: { seriesId: string; held: boolean; cleaners: CleanerOption[]; summary: string }) {
  const [mode, setMode] = useState<Mode>(null);
  const [cleaner, setCleaner] = useState("");
  const [reason, setReason] = useState("");
  const { result, setResult, pending, run } = useRun();
  const selectId = useId();
  const reasonId = useId();
  const open = (m: Mode) => { setMode(m); setResult(null); };
  const chosen = cleaners.find((c) => c.id === cleaner);

  return (
    <div className="grid gap-3">
      {!mode ? (
        <div className="flex flex-wrap gap-2">
          {held ? (
            <Button variant="secondary" onClick={() => open("reopen")}>Put back on the board</Button>
          ) : (
            <Button variant="primary" onClick={() => open("assign")}>Assign a cleaner</Button>
          )}
          <Button variant="ghost" onClick={() => open("end")}>End block</Button>
        </div>
      ) : null}

      {mode === "assign" ? (
        <Panel>
          <label htmlFor={selectId} className="text-sm font-semibold">Give {summary} to</label>
          <select id={selectId} value={cleaner} onChange={(e) => setCleaner(e.target.value)}
            className="min-h-12 rounded-md bg-card px-3 text-base ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-blue">
            <option value="">Choose a cleaner</option>
            {cleaners.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          {chosen && !chosen.fits ? <p className="text-sm font-semibold text-warn">They don&rsquo;t normally cover this area or day. Check with them first.</p> : null}
          <p className="text-sm text-navy-2">Every clean of the block is booked in for them at once, and the offers to other cleaners are withdrawn.</p>
          <Row>
            <Button pending={pending} disabled={!cleaner} onClick={() => run(() => assignBlock({ seriesId, cleanerId: cleaner }), () => setMode(null))}>Confirm assignment</Button>
            <Button variant="ghost" disabled={pending} onClick={() => open(null)}>Cancel</Button>
          </Row>
        </Panel>
      ) : null}

      {mode === "reopen" ? (
        <Panel>
          <p className="font-semibold">Put {summary} back on the board?</p>
          <p className="text-sm text-navy-2">The current cleaner loses it and its future cleans are removed. It&rsquo;s offered again from Top cleaners, without them. A clean booked for today stays, with a &ldquo;needs cover&rdquo; alert.</p>
          <Row>
            <Button pending={pending} onClick={() => run(() => reopenBlock({ seriesId }), () => setMode(null))}>Yes, put it back</Button>
            <Button variant="ghost" disabled={pending} onClick={() => open(null)}>Cancel</Button>
          </Row>
        </Panel>
      ) : null}

      {mode === "end" ? (
        <Panel>
          <label htmlFor={reasonId} className="text-sm font-semibold">Why is {summary} ending? Kept on the block.</label>
          <textarea id={reasonId} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md bg-card px-4 py-3 text-base ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-blue" />
          <p className="text-sm text-navy-2">Offers are withdrawn and cleans still booked from today on are cancelled. The cleaner loses the address. This can&rsquo;t be undone: the customer books again for more.</p>
          <Row>
            <Button variant="danger" pending={pending} disabled={!reason.trim()} onClick={() => run(() => endBlock({ seriesId, reason }), () => setMode(null))}>End the block</Button>
            <Button variant="ghost" disabled={pending} onClick={() => open(null)}>Cancel</Button>
          </Row>
        </Panel>
      ) : null}

      {result ? <Message result={result} /> : null}
    </div>
  );
}

export function ResolveAlert({ alertId }: { alertId: string }) {
  const [confirming, setConfirming] = useState(false);
  const { result, pending, run } = useRun();
  return (
    <div className="grid gap-2">
      {confirming ? (
        <Row>
          <Button variant="ink" pending={pending} onClick={() => run(() => resolveAlert({ alertId }), () => setConfirming(false))}>Yes, it&rsquo;s sorted</Button>
          <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button>
        </Row>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>Mark resolved</Button>
      )}
      {result ? <Message result={result} /> : null}
    </div>
  );
}

export type SettleInfo = {
  visitId: string;
  /** Tapped Start and never finished (it will be cancelled), or never started (it stays missed). */
  started: boolean;
  /** "the Whitehaven CA28 clean of Friday 20 November" */
  summary: string;
  customer: string;
  /** Who the clean was booked with: the person "done" pays. Null when it had no cleaner. */
  cleaner: string | null;
  /** The clean's own three amounts, already formatted. Null when it costs nothing. */
  money: { charge: string; pay: string; fee: string } | null;
  /** Items the cleaner marked "couldn't do" before they stopped. */
  couldntDo: number;
  /** The block is on hold for an unpaid clean. */
  onHold: boolean;
};

type Answer = "done" | "not_done";

/**
 * A missed or unfinished clean: was it done or not? Either answer opens a step that names
 * who is charged, who is paid and when, takes a few words on what happened, and needs a
 * second tap. `only="done"` is the way back for a missed clean first marked as not done:
 * it tells the database so, and anywhere else a clean a colleague has since settled is
 * refused rather than settled twice.
 *
 * Renders as `display: contents`, so inside the alert card's two-column grid the two
 * answers sit top-right like every other alert's action, and the open step takes the
 * card's full width underneath.
 */
export function SettleClean({ info, only }: { info: SettleInfo; only?: "done" }) {
  const router = useRouter();
  const [mode, setMode] = useState<Answer | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const headingId = useId();
  const reasonId = useId();
  const hintId = useId();
  const heading = useRef<HTMLParagraphElement>(null);
  const opener = useRef<Answer | null>(null);
  const buttons = useRef<Partial<Record<Answer, HTMLButtonElement | null>>>({});
  const who = info.cleaner ?? "the cleaner";

  // The tapped button leaves the page when the step opens, and comes back when it closes:
  // move the keyboard and the screen reader with it, both ways.
  useEffect(() => {
    if (mode) heading.current?.focus();
    else if (opener.current) buttons.current[opener.current]?.focus();
  }, [mode]);

  const open = (m: Answer) => { opener.current = m; setResult(null); setMode(m); };
  const close = () => { setResult(null); setMode(null); };
  const send = () =>
    start(async () => {
      let r: Awaited<ReturnType<typeof settleClean>>;
      try {
        // The way back is the one place that knows the clean was already marked as not done.
        r = await settleClean({ visitId: info.visitId, outcome: mode, reason, wasNotDone: only === "done" });
      } catch {
        // The reply was lost, not necessarily the request: the charge may have gone through.
        setResult({ ok: false, message: "We couldn’t confirm that went through. Refresh the page before trying again." });
        return;
      }
      if (r.ok) {
        // The card goes with the alert, so the confirmation is shown by the page itself.
        router.replace(`/admin/jobs?settled=${info.visitId}#alerts` as Route);
        router.refresh();
        return;
      }
      setResult(r);
      if (r.stale) {
        // Someone else settled it while this step was open. Their answer is what stands:
        // close the step and let the page say what happened to the clean.
        setMode(null);
        router.replace(`/admin/jobs?settled=${info.visitId}&late=1#alerts` as Route);
        router.refresh();
      }
    });

  return (
    <div className="contents">
      {!mode ? (
        <div className="grid gap-2 sm:col-start-2 sm:row-start-1 sm:flex sm:flex-wrap sm:justify-end sm:self-start">
          {info.cleaner ? (
            <Button ref={(el) => { buttons.current.done = el; }} variant="secondary" onClick={() => open("done")}>
              {only ? "It was done after all" : "It was done"}
            </Button>
          ) : null}
          {only ? null : (
            <Button ref={(el) => { buttons.current.not_done = el; }} variant="secondary" onClick={() => open("not_done")}>It wasn&rsquo;t done</Button>
          )}
        </div>
      ) : (
        <div role="group" aria-labelledby={headingId} className="grid gap-4 rounded-md bg-mist/70 p-5 ring-1 ring-inset ring-line sm:col-span-2">
          <p id={headingId} ref={heading} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
            Mark {info.summary} as {mode === "done" ? "done" : "not done"}?
          </p>

          {mode === "done" ? (
            <>
              {info.money ? (
                <dl className="grid gap-4 sm:grid-cols-3">
                  <Figure label={`Charged to ${info.customer}’s card, now`} value={info.money.charge} />
                  <Figure label={`Paid to ${who}, after the check period`} value={info.money.pay} />
                  <Figure label="Ping’s fee" value={info.money.fee} />
                </dl>
              ) : (
                <p className="text-navy-2">It counts as a finished clean for {who}. There&rsquo;s nothing to charge for it.</p>
              )}
              {info.couldntDo > 0 ? (
                <p className="text-sm font-semibold text-warn">
                  {who} marked {info.couldntDo} {info.couldntDo === 1 ? "item" : "items"} &ldquo;couldn&rsquo;t do&rdquo; before stopping. It&rsquo;s charged in full all the same.
                </p>
              ) : null}
              {info.onHold && info.money ? (
                <p className="text-sm font-semibold text-warn">This block is on hold for a payment that hasn&rsquo;t gone through. This adds another charge to the same card.</p>
              ) : null}
              <p className="text-sm text-navy-2">
                {info.money ? "This can’t be undone. If the charge is wrong, refund it from Payments." : "This can’t be undone."}
              </p>
            </>
          ) : info.started ? (
            <p className="max-w-prose text-navy-2">The clean is cancelled. Nobody is charged and {who} isn&rsquo;t paid. This can&rsquo;t be undone.</p>
          ) : (
            <p className="max-w-prose text-navy-2">
              It stays as a missed clean and this alert closes. Nobody is charged and {who} isn&rsquo;t paid. If it turns out the clean did happen, you can still mark it as done: it&rsquo;s kept under &ldquo;Marked as not done&rdquo;, below the alerts.
            </p>
          )}

          <div className="grid gap-2">
            <label htmlFor={reasonId} className="text-sm font-semibold">What happened? Kept on the clean, seen only by the Ping team.</label>
            <textarea id={reasonId} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={hintId}
              className="w-full max-w-3xl rounded-md bg-card px-4 py-3 text-base ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-blue" />
            <p id={hintId} className="text-sm text-navy-3">Needed before you can confirm.</p>
          </div>

          <div className="grid gap-3 sm:flex sm:flex-wrap">
            <Button variant={mode === "done" ? "primary" : info.started ? "danger" : "ink"} pending={pending} disabled={!reason.trim()} onClick={send}>
              {mode === "done" ? (info.money ? `Yes, charge ${info.money.charge}` : "Yes, it was done") : info.started ? "Yes, cancel the clean" : "Yes, leave it as missed"}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={close}>Cancel</Button>
          </div>
        </div>
      )}
      {result ? <div className="sm:col-span-2"><Message result={result} /></div> : null}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-navy-2">{label}</dt>
      <dd className="font-display text-2xl font-semibold tabular">{value}</dd>
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid gap-3 rounded-md bg-mist/70 p-4 ring-1 ring-inset ring-line", className)}>{children}</div>;
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-3">{children}</div>;
}

function Message({ result }: { result: ActionResult }) {
  return (
    <p role={result.ok ? "status" : "alert"} className={cn("text-sm font-semibold", result.ok ? "text-ok" : "text-bad")}>
      {result.message ?? "Done."}
    </p>
  );
}
