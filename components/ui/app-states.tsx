"use client";

import { Button } from "./button";
import { ErrorState } from "./states";
import { Skeleton } from "./surface";

/** Shared loading screen for the three apps: the shape of the page, not a spinner. */
export function AppLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid gap-8">
      <div className="grid gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-11 w-2/3 max-w-xl" />
        <Skeleton className="h-5 w-1/2 max-w-md" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-lg" />
        <div className="grid gap-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** Shared error boundary screen. Never shows the raw error to the user. */
export function AppError({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      title="Something went wrong on our side"
      action={
        <Button variant="ink" onClick={reset}>
          Try again
        </Button>
      }
    >
      It&rsquo;s not you. Try again, and if it keeps happening, call the Ping office and we&rsquo;ll look into it.
    </ErrorState>
  );
}
