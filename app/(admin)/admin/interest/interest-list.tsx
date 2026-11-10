"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { formatStamp } from "@/lib/dates";
import { NOT_SAVED, type ActionResult } from "../_lib/errors";
import { deleteInterest, markTold } from "./actions";

export type InterestRow = {
  id: string;
  postcode_district: string;
  contact_type: "email" | "phone";
  contact_masked: string;
  source: "instant_price" | "holding_page";
  registered_at: string;
  notified_at: string | null;
  unsubscribed_at: string | null;
};

const SOURCE = { instant_price: "Instant price", holding_page: "Booking opens soon page" } as const;

/** The masked list: tick people to mark told (or undo), and delete one on request. */
export function InterestList({ rows }: { rows: InterestRow[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      let r: ActionResult;
      try { r = await fn(); } catch { r = { ok: false, message: NOT_SAVED }; }
      setResult(r);
      if (r.ok) { after?.(); router.refresh(); }
    });

  const live = rows.filter((r) => !r.unsubscribed_at);
  const chosen = rows.filter((r) => picked.has(r.id));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPicked = live.length > 0 && live.every((r) => picked.has(r.id));

  return (
    <div className="grid gap-4">
      <div className="sticky top-20 z-10 flex flex-wrap items-center gap-3 rounded-lg bg-canvas/95 py-2 backdrop-blur">
        <Button variant="secondary" disabled={pending} onClick={() => setPicked(allPicked ? new Set() : new Set(live.map((r) => r.id)))}>
          {allPicked ? "Untick all" : "Tick all"}
        </Button>
        <Button disabled={pending || !chosen.some((r) => !r.notified_at)} pending={pending}
          onClick={() => run(() => markTold({ ids: chosen.filter((r) => !r.notified_at).map((r) => r.id), told: true }), () => setPicked(new Set()))}>
          Mark {chosen.filter((r) => !r.notified_at).length || ""} as told
        </Button>
        <Button variant="ghost" disabled={pending || !chosen.some((r) => r.notified_at)}
          onClick={() => run(() => markTold({ ids: chosen.filter((r) => r.notified_at).map((r) => r.id), told: false }), () => setPicked(new Set()))}>
          Undo told
        </Button>
        {result ? <p role={result.ok ? "status" : "alert"} className={cn("text-sm font-semibold", result.ok ? "text-ok" : "text-bad")}>{result.message}</p> : null}
      </div>

      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.id} className={cn("grid gap-3 rounded-lg bg-card p-4 shadow-card ring-1 ring-line/70 sm:p-5", r.unsubscribed_at && "opacity-70")}>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input type="checkbox" checked={picked.has(r.id)} disabled={!!r.unsubscribed_at} onChange={() => toggle(r.id)}
                  className="size-5 shrink-0 accent-[var(--color-blue)]" aria-label={`Tick ${r.contact_masked}`} />
                <span className="grid min-w-0">
                  <span className="truncate font-semibold tabular">{r.contact_masked}</span>
                  <span className="text-sm text-navy-3">{r.postcode_district} · {r.contact_type === "email" ? "Email" : "Mobile"} · {SOURCE[r.source]} · {formatStamp(r.registered_at)}</span>
                </span>
              </label>
              {r.unsubscribed_at ? <Badge>Unsubscribed</Badge> : r.notified_at ? <Badge tone="ok">Told {formatStamp(r.notified_at)}</Badge> : <Badge tone="warn">Not told yet</Badge>}
              {deleting !== r.id ? (
                <Button variant="ghost" disabled={pending} onClick={() => { setDeleting(r.id); setResult(null); }}>Delete on request</Button>
              ) : null}
            </div>
            {deleting === r.id ? (
              <DeleteConfirm row={r} pending={pending} onCancel={() => setDeleting(null)}
                onDelete={(arrivedBy, senderMatches) => run(() => deleteInterest({ id: r.id, arrivedBy, senderMatches }), () => setDeleting(null))} />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeleteConfirm({ row, pending, onCancel, onDelete }: {
  row: InterestRow; pending: boolean; onCancel: () => void; onDelete: (arrivedBy: "email" | "phone", senderMatches: boolean) => void;
}) {
  const [arrivedBy, setArrivedBy] = useState<"email" | "phone" | null>(null);
  const [matches, setMatches] = useState(false);
  const what = row.contact_type === "email" ? "email address" : "mobile number";
  return (
    <div className="grid gap-4 rounded-md bg-bad-soft/50 p-4 ring-1 ring-inset ring-bad/25" role="group" aria-label={`Delete ${row.contact_masked}`}>
      <p className="font-semibold">Only delete when the person asked, from this {what}.</p>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">How did the request arrive?</legend>
        {([["email", "By email"], ["phone", "By text message"]] as const).map(([v, label]) => (
          <label key={v} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md bg-card px-4 ring-1 ring-inset ring-line">
            <input type="radio" name={`arrived-${row.id}`} checked={arrivedBy === v} onChange={() => setArrivedBy(v)} className="size-5 accent-[var(--color-blue)]" />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md bg-card px-4 py-3 ring-1 ring-inset ring-line">
        <input type="checkbox" checked={matches} onChange={(e) => setMatches(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--color-blue)]" />
        <span>I&rsquo;ve checked the request came from <span className="font-semibold tabular">{row.contact_masked}</span>, the {what} on this entry.</span>
      </label>
      <p className="text-sm text-navy-2">Deleting is permanent and is logged (without the contact).</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" pending={pending} disabled={!arrivedBy || !matches} onClick={() => arrivedBy && onDelete(arrivedBy, matches)}>Delete permanently</Button>
        <Button variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
