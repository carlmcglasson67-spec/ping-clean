"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { NOT_SAVED, type ActionResult } from "../_lib/errors";
import { assignBlock, endBlock, reopenBlock, resolveAlert } from "./actions";

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
          <p className="text-sm text-navy-2">Offers are withdrawn and cleans still booked from today on are removed. The cleaner loses the address. This can&rsquo;t be undone: the customer books again for more.</p>
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

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 rounded-md bg-mist/70 p-4 ring-1 ring-inset ring-line">{children}</div>;
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
