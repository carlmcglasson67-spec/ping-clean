"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { NOT_SAVED, type ActionResult } from "../_lib/errors";
import { scoreVisit } from "./actions";

/** 1 to 10 as ten big targets, optional notes for the team, one save. */
export function ScoreForm({ visitId }: { visitId: string }) {
  const router = useRouter();
  const [score, setScore] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const notesId = useId();
  const legendId = useId();

  const save = () =>
    start(async () => {
      let r: ActionResult;
      try {
        r = await scoreVisit({ visitId, score, notes });
      } catch {
        r = { ok: false, message: NOT_SAVED };
      }
      setResult(r);
      if (r.ok) router.refresh();
    });

  return (
    <div className="grid gap-4">
      <fieldset aria-labelledby={legendId} className="grid gap-3">
        <legend id={legendId} className="text-sm font-semibold">QC score</legend>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <label key={n} className={cn(
              "grid min-h-12 cursor-pointer place-items-center rounded-md font-display text-lg font-semibold tabular ring-1 ring-inset transition-colors",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue",
              score === n ? "bg-navy text-on-navy ring-navy" : "bg-card ring-line hover:ring-navy-3",
            )}>
              <input type="radio" name={`score-${visitId}`} value={n} checked={score === n} onChange={() => { setScore(n); setResult(null); }} className="sr-only" />
              {n}
            </label>
          ))}
        </div>
        <p className="text-sm text-navy-3">10 is spotless and everything done. The cleaner sees their score; the customer never does.</p>
      </fieldset>
      <label htmlFor={notesId} className="grid gap-2 text-sm font-semibold">
        Notes (optional; the cleaner can read these with their score)
        <textarea id={notesId} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-md bg-card px-4 py-3 text-base font-normal ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-blue" />
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <Button pending={pending} disabled={score === null} onClick={save}>{score ? `Save score: ${score}` : "Choose a score"}</Button>
        {result ? <p role={result.ok ? "status" : "alert"} className={cn("text-sm font-semibold", result.ok ? "text-ok" : "text-bad")}>{result.message}</p> : null}
      </div>
    </div>
  );
}
