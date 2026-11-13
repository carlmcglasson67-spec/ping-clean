"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { cancelBlockAction, cancelCleanAction, type CancelResult } from "./actions";

export type CleanRow = {
  id: string;
  day: string; // "Wednesday 25 November"
  window: string; // "10am–2pm"
  status: { label: string; tone: "neutral" | "signal" | "ok" | "warn" | "bad" | "mist" };
  /** Null when this clean can't be cancelled (under way, done, already off). */
  terms: { late: boolean; noticeHours: number | null; fee: string | null } | null;
};

/** What cancelling costs, in one plain sentence. The database decides; this only words it. */
function consequence(t: NonNullable<CleanRow["terms"]>) {
  if (!t.late) return t.noticeHours ? `It’s free: there’s more than ${t.noticeHours} hours’ notice.` : "It’s free.";
  const notice = `Your cleaner has less than ${t.noticeHours} hours’ notice.`;
  return t.fee ? `${notice} A late cancellation fee of ${t.fee} applies.` : `${notice} There’s no charge, but please only cancel this late if you have to.`;
}

/**
 * The block's cleans, each with its own "Cancel", and "Cancel the rest" underneath. Every
 * cancel asks once more first and says plainly whether it's free. Nothing is cancelled
 * until the customer confirms.
 */
export function Cleans({ seriesId, cleans, canCancelBlock }: { seriesId: string; cleans: CleanRow[]; canCancelBlock: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState<string | null>(null); // a clean's id, or "block"
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const open = cleans.filter((c) => c.terms);
  const anyLate = open.some((c) => c.terms!.late);
  const lateFee = open.find((c) => c.terms!.late && c.terms!.fee)?.terms?.fee ?? null;

  async function run(what: () => Promise<CancelResult>, done: (r: Extract<CancelResult, { ok: true }>) => string) {
    setBusy(true);
    setNote(null);
    const r = await what().catch(() => ({ ok: false, error: "We couldn’t cancel that just now. Nothing has changed. Please try again." }) as const);
    setBusy(false);
    setAsking(null);
    if (r.ok) {
      setNote({ tone: "ok", text: done(r) });
      router.refresh();
    } else setNote({ tone: "bad", text: r.error });
  }

  return (
    <div className="grid gap-6">
      {note ? (
        <p role={note.tone === "bad" ? "alert" : "status"} className={note.tone === "bad" ? "rounded-md bg-bad-soft px-5 py-4 text-lg font-semibold text-bad" : "rounded-md bg-ok-soft px-5 py-4 text-lg font-semibold text-ok"}>
          {note.text}
        </p>
      ) : null}

      <ul className="grid">
        {cleans.map((c) => (
          <li key={c.id} className="grid gap-4 border-t border-line py-5 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <div>
                <p className="text-lg font-semibold">{c.day}</p>
                <p className="text-base text-navy-2">{c.window}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={c.status.tone}>{c.status.label}</Badge>
                {c.terms && asking !== c.id ? (
                  <Button variant="secondary" size="md" onClick={() => { setNote(null); setAsking(c.id); }} disabled={busy} aria-label={`Cancel the clean on ${c.day}`}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
            {c.terms && asking === c.id ? (
              <div role="group" aria-label={`Cancel the clean on ${c.day}?`} className={`grid gap-4 rounded-lg p-5 ${c.terms.late ? "bg-warn-soft ring-1 ring-warn/25" : "bg-mist"}`}>
                <p className="text-lg">
                  <span className="font-semibold">Cancel the clean on {c.day}?</span> {consequence(c.terms)}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="danger" size="lg" pending={busy} onClick={() => run(() => cancelCleanAction(seriesId, c.id), (r) => (r.late ? `Cancelled. We’ll let your cleaner know straight away.` : `Cancelled. Nothing is charged for that clean.`))}>
                    Yes, cancel this clean
                  </Button>
                  <Button variant="ghost" size="lg" onClick={() => setAsking(null)} disabled={busy}>
                    Keep it
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {canCancelBlock ? (
        asking === "block" ? (
          <div role="group" aria-label="Cancel the rest of your cleans?" className={`grid gap-4 rounded-lg p-5 ${anyLate ? "bg-warn-soft ring-1 ring-warn/25" : "bg-mist"}`}>
            <p className="text-lg">
              <span className="font-semibold">Cancel {open.length > 0 ? `all ${open.length} ${open.length === 1 ? "clean" : "cleans"} still to come` : "this booking"}?</span>{" "}
              {anyLate
                ? `One of them is at short notice${lateFee ? `, so a late cancellation fee of ${lateFee} applies to it` : ""}. The rest are free.`
                : "It’s free, and you can book again whenever you like."}{" "}
              Cleans already finished stay as they are.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="danger" size="lg" pending={busy} onClick={() => run(() => cancelBlockAction(seriesId), () => "Your remaining cleans are cancelled. You’re welcome back any time.")}>
                Yes, cancel them
              </Button>
              <Button variant="ghost" size="lg" onClick={() => setAsking(null)} disabled={busy}>
                Keep my cleans
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="md" className="justify-self-start text-navy-2" onClick={() => { setNote(null); setAsking("block"); }} disabled={busy}>
            {open.length > 0 ? "Cancel the rest of my cleans" : "Cancel this booking"}
          </Button>
        )
      ) : null}
    </div>
  );
}
