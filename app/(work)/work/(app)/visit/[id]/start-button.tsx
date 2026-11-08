"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { startVisit } from "./actions";

/** One tap: start today's clean, then straight into its checklist. Safe to tap twice. */
export function StartButton({ visitId, goTo }: { visitId: string; goTo?: `/work/visit/${string}` }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="grid gap-3">
      {error ? <p role="alert" className="rounded-md bg-bad-soft px-4 py-3 font-medium text-bad">{error}</p> : null}
      <Button
        size="xl"
        variant="ink"
        pending={pending}
        className="w-full"
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const res = await startVisit(visitId);
              if (!res.ok) return setError(res.message);
              if (goTo) router.push(goTo);
              else router.refresh();
            } catch {
              setError("That didn't send. Your signal may have dropped. Tap Start again.");
            }
          })
        }
      >
        {pending ? "Starting…" : "Start the clean"}
      </Button>
    </div>
  );
}
