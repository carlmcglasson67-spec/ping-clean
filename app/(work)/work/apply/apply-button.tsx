"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui";
import { applyAsCleaner, type ApplyState } from "./actions";

export function ApplyButton() {
  const router = useRouter();
  const [state, action, pending] = useActionState<ApplyState>(applyAsCleaner, {});
  useEffect(() => {
    if (state.ok) router.replace("/work/details");
  }, [state.ok, router]);
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
