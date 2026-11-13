"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { cancelBlock, type CancelBlockState } from "./actions";

/** One confirm button. It sends the total the customer is looking at, so they're never charged a figure they didn't see. */
export function CancelBlockButton({ seriesId, feePence, label }: { seriesId: string; feePence: number; label: string }) {
  const [state, action, pending] = useActionState<CancelBlockState, FormData>(cancelBlock, {});
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="seriesId" value={seriesId} />
      <input type="hidden" name="shownFeePence" value={feePence} />
      {state.error ? <p role="alert" className="rounded-md bg-bad-soft px-5 py-4 font-medium text-bad">{state.error}</p> : null}
      <Button type="submit" size="xl" variant={feePence > 0 ? "ink" : "primary"} pending={pending} className="w-full sm:w-auto sm:justify-self-start">
        {pending ? "Cancelling…" : label}
      </Button>
    </form>
  );
}
