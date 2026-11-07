"use client";

import { useState, type ReactNode } from "react";

/**
 * Before and after, one frame. Drag the handle (or use the arrow keys: it's a real
 * range input underneath) to wipe between the two.
 */
export function BeforeAfter({ before, after, label }: { before: ReactNode; after: ReactNode; label: string }) {
  const [pos, setPos] = useState(52);
  return (
    <div className="relative select-none overflow-hidden rounded-lg has-[input:focus-visible]:ring-4 has-[input:focus-visible]:ring-teal">
      <div className="relative">{after}</div>
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        {before}
      </div>

      <span className="pointer-events-none absolute left-4 top-4 rounded-full bg-navy/80 px-4 py-1.5 text-sm font-semibold text-on-navy backdrop-blur sm:left-6 sm:top-6">
        Before
      </span>
      <span className="pointer-events-none absolute right-4 top-4 rounded-full bg-canvas/90 px-4 py-1.5 text-sm font-semibold text-navy backdrop-blur sm:right-6 sm:top-6">
        After
      </span>

      {/* The handle */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 w-[3px] -translate-x-1/2 bg-canvas shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-navy)_15%,transparent)]" style={{ left: `${pos}%` }}>
        <span className="absolute left-1/2 top-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-canvas text-navy shadow-lift">
          <svg viewBox="0 0 24 24" className="size-6">
            <path d="M9 6 3 12l6 6M15 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={`${pos}% before`}
        className="absolute inset-0 size-full cursor-ew-resize appearance-none opacity-0"
      />
    </div>
  );
}
