"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { openStripe, type SetupState } from "./actions";

/** One tap to Stripe's form. `quiet` is the lesser version once they're already set up. */
export function SetupButton({ label, quiet = false }: { label: string; quiet?: boolean }) {
  const [state, action, pending] = useActionState<SetupState>(openStripe, {});
  return (
    <form action={action} className="grid gap-4">
      {state.error ? (
        <p role="alert" className="rounded-md bg-bad-soft px-5 py-4 font-medium text-bad">{state.error}</p>
      ) : null}
      <Button type="submit" size={quiet ? "lg" : "xl"} variant={quiet ? "onNavy" : "signal"} pending={pending} className="w-full sm:w-auto sm:justify-self-start">
        {pending ? "Opening Stripe…" : label}
      </Button>
    </form>
  );
}
