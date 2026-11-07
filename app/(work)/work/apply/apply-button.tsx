"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui";
import { applyAsCleaner, type ApplyState } from "./actions";

export function ApplyButton() {
  const [state, action, pending] = useActionState<ApplyState>(applyAsCleaner, {});
  useEffect(() => {
    // A full page load, on purpose. Applying changes who this login is: the client router
    // still holds pages prefetched as a customer (/work → "go to /account"), and a soft
    // navigation reuses them and loops between the two apps.
    if (state.ok) window.location.replace("/work/details");
  }, [state.ok]);
  const busy = pending || state.ok;

  return (
    <form action={action} className="grid gap-4">
      {state.error ? (
        <p role="alert" className="rounded-md bg-bad-soft px-5 py-4 font-medium text-bad">{state.error}</p>
      ) : null}
      <Button type="submit" size="xl" pending={busy} className="w-full sm:w-auto">
        {busy ? "Starting your application…" : "Start my application"}
      </Button>
    </form>
  );
}
