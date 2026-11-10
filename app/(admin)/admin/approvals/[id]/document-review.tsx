"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { buttonClass } from "@/components/ui/button";
import type { ActionResult } from "../../_lib/errors";
import { NOT_SAVED } from "../../_lib/errors";
import type { DocStatus } from "../_lib/vetting";
import { reviewDocument } from "../actions";

/**
 * Open, verify or send back one document. Sending back needs a reason, because the cleaner
 * reads it ("The photo is cut off at the bottom, please send all of it").
 */
export function DocumentReview({ documentId, status, openHref, rejectionReason, outOfDate }: { documentId: string; status: DocStatus; openHref: string; rejectionReason: string | null; outOfDate: boolean }) {
  const router = useRouter();
  const reasonId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const run = (input: Parameters<typeof reviewDocument>[0]) =>
    start(async () => {
      let r: ActionResult;
      try {
        r = await reviewDocument(input);
      } catch {
        r = { ok: false, message: NOT_SAVED };
      }
      setResult(r);
      if (r.ok) {
        setRejecting(false);
        setReason("");
        router.refresh();
      }
    });

  // Never an out-of-date document, and never one already expired: those need a new upload.
  const canVerify = (status === "pending" || status === "rejected") && !outOfDate;
  const canReject = status === "pending" || status === "verified";

  return (
    <div className="grid gap-4">
      {rejectionReason ? (
        <p className="rounded-md bg-bad-soft/60 px-4 py-3 text-sm text-navy-2">
          <span className="font-semibold text-bad">Sent back: </span>
          {rejectionReason}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <a href={openHref} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md")}>
          Open document
        </a>
        {canVerify ? (
          <Button variant="primary" pending={pending && !rejecting} disabled={pending} onClick={() => run({ decision: "verify", documentId, expected: status as "pending" | "rejected" })}>
            Verify
          </Button>
        ) : null}
        {canReject && !rejecting ? (
          <Button variant="ghost" disabled={pending} onClick={() => { setRejecting(true); setResult(null); }}>
            Send back
          </Button>
        ) : null}
      </div>
      {outOfDate && status !== "verified" ? <p className="text-sm font-semibold text-bad">Out of date, so it can&rsquo;t be verified. Send it back and ask for a current one.</p> : null}
      <p className="text-sm text-navy-3">The link opens for 10 minutes, then expires. Check the name, the dates and that nothing is cut off.</p>

      {rejecting ? (
        <form
          className="grid gap-3 rounded-md bg-mist/70 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            run({ decision: "reject", documentId, expected: status as "pending" | "verified", reason });
          }}
        >
          <label htmlFor={reasonId} className="text-sm font-semibold">Why is it going back? The cleaner will read this.</label>
          <textarea
            id={reasonId}
            required
            maxLength={300}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md bg-card px-4 py-3 text-base ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-blue"
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="danger" pending={pending}>Send it back</Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => { setRejecting(false); setResult(null); }}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {result ? (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-sm font-semibold text-ok" : "text-sm font-semibold text-bad"}>
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
