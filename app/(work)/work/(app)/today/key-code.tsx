"use client";

import { useState } from "react";

/**
 * Hidden until tapped, so it isn't on show to anyone glancing at the phone. Never
 * copied, stored or cached on the device: it lives only in this page while it's open.
 */
export function KeyCode({ code }: { code: string }) {
  const [shown, setShown] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setShown((s) => !s)}
      aria-pressed={shown}
      className="flex min-h-14 w-full items-center justify-between gap-4 rounded-md bg-ink px-5 text-left text-paper transition-colors hover:bg-[#1d2732]"
    >
      <span className="text-sm font-semibold uppercase tracking-[0.14em] text-paper/70">Key code</span>
      {shown ? (
        <span className="font-display text-2xl font-semibold tracking-[0.2em] tabular">{code}</span>
      ) : (
        <span className="font-semibold">Show key code</span>
      )}
    </button>
  );
}
