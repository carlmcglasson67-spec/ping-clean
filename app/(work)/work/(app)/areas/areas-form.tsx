"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { formatTime, weekdayName } from "@/lib/dates";
import { DEFAULT_SLOT, DISTRICT_TOWN, TIMES, type Slot } from "../../_lib/availability";
import { saveAreas, type AreasState } from "./actions";

type Props = { districts: string[]; areas: string[]; slots: Record<number, Slot> };

const DAYS = [1, 2, 3, 4, 5, 6, 7];

export function AreasForm({ districts, areas, slots }: Props) {
  const [state, action, pending] = useActionState<AreasState, FormData>(saveAreas, {});
  const [picked, setPicked] = useState(() => new Set(areas));
  const [on, setOn] = useState(() => new Set(DAYS.filter((d) => slots[d])));
  // Every field is held here, so a failed save keeps exactly what the cleaner chose.
  const [times, setTimes] = useState<Record<number, { from: string; to: string }>>(() =>
    Object.fromEntries(DAYS.map((d) => [d, { from: slots[d]?.from ?? DEFAULT_SLOT.from, to: slots[d]?.to ?? DEFAULT_SLOT.to }])),
  );
  const setTime = (d: number, k: "from" | "to", v: string) => setTimes((t) => ({ ...t, [d]: { ...t[d]!, [k]: v } }));
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  return (
    <form
      // onSubmit, not action=: React resets a form after its action runs, which would put
      // every time back to 6am while the cleaner fixes one mistake.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setDirty(false);
        startTransition(() => action(fd));
      }}
      className="grid gap-12"
      onChange={touch}
    >
      <fieldset className="grid gap-5" aria-describedby="areas-hint">
        <legend className="mb-2 text-xl font-semibold">Where you&rsquo;ll travel to</legend>
        <p id="areas-hint" className="text-ink-2">
          Tick every postcode area you&rsquo;re happy to clean in. You&rsquo;re only offered jobs in these.
        </p>
        {state.fieldError === "areas" && state.error ? <p role="alert" className="font-medium text-bad">{state.error}</p> : null}
        {districts.length === 0 ? (
          <p className="rounded-md bg-paper-2 p-5 text-ink-2">Ping hasn&rsquo;t opened any areas yet. We&rsquo;ll let you know as soon as we do.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {districts.map((d) => {
              const checked = picked.has(d);
              return (
                <li key={d}>
                  <label
                    className={cn(
                      "relative flex min-h-20 cursor-pointer flex-col justify-center gap-0.5 rounded-md px-5 py-3 ring-1 ring-inset transition-colors select-none",
                      "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-signal",
                      checked ? "bg-ink text-paper ring-ink" : "bg-card text-ink ring-line hover:ring-ink-3",
                    )}
                  >
                    <input
                      type="checkbox"
                      name="areas"
                      value={d}
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(d);
                        else next.delete(d);
                        setPicked(next);
                      }}
                      className="sr-only"
                    />
                    <span className="font-display text-2xl font-semibold tabular">{d}</span>
                    <span className={cn("text-sm", checked ? "text-paper/70" : "text-ink-3")}>{DISTRICT_TOWN[d] ?? "West Cumbria"}</span>
                    {checked ? (
                      <svg viewBox="0 0 24 24" className="absolute right-4 top-4 size-5 text-signal" aria-hidden>
                        <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <fieldset className="grid gap-5" aria-describedby="days-hint">
        <legend className="mb-2 text-xl font-semibold">The days you work</legend>
        <p id="days-hint" className="text-ink-2">
          You&rsquo;re offered jobs on the days you switch on. Leave them all off and you&rsquo;ll see jobs on any day.
        </p>
        {state.fieldError === "days" && state.error ? <p role="alert" className="font-medium text-bad">{state.error}</p> : null}
        <ul className="grid gap-3">
          {DAYS.map((d) => {
            const working = on.has(d);
            const name = weekdayName(d);
            return (
              <li key={d} className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md p-4 ring-1 ring-inset sm:flex-nowrap sm:p-5", working ? "bg-card ring-line" : "bg-paper-2/60 ring-line/60")}>
                <label className="flex min-h-12 flex-1 cursor-pointer items-center gap-4 select-none sm:w-48 sm:flex-none">
                  <input
                    type="checkbox"
                    name={`day-${d}`}
                    checked={working}
                    onChange={(e) => {
                      const next = new Set(on);
                      if (e.target.checked) next.add(d);
                      else next.delete(d);
                      setOn(next);
                    }}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "relative h-8 w-14 shrink-0 rounded-full transition-colors peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal",
                      working ? "bg-ok" : "bg-line",
                    )}
                  >
                    <span className={cn("absolute top-1 size-6 rounded-full bg-paper shadow transition-transform", working ? "translate-x-7" : "translate-x-1")} />
                  </span>
                  <span className="text-lg font-semibold">{name}</span>
                </label>
                {working ? (
                  <div className="grid basis-full grid-cols-[1fr_auto_1fr] items-center gap-3 sm:basis-auto sm:flex-1">
                    <TimeSelect label={`${name} start`} name={`from-${d}`} value={times[d]!.from} onChange={(v) => setTime(d, "from", v)} />
                    <span className="text-ink-3">to</span>
                    <TimeSelect label={`${name} finish`} name={`to-${d}`} value={times[d]!.to} onChange={(v) => setTime(d, "to", v)} />
                  </div>
                ) : (
                  <p className="text-ink-3">Day off</p>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="grid gap-3 sm:flex sm:items-center sm:gap-5">
        <Button type="submit" size="lg" pending={pending} className="w-full sm:w-auto">
          {pending ? "Saving…" : "Save where and when I work"}
        </Button>
        {state.error && !state.fieldError ? <p role="alert" className="font-medium text-bad">{state.error}</p> : null}
        {state.saved && !pending && !dirty ? <p role="status" className="font-semibold text-ok">Saved. New jobs will match these.</p> : null}
      </div>
    </form>
  );
}

function TimeSelect({ label, name, value, onChange }: { label: string; name: string; value: string; onChange: (v: string) => void }) {
  // Keep a stored time that isn't on the half hour (set by the Ping team) rather than lose it.
  const options = TIMES.includes(value) ? TIMES : [...TIMES, value].sort();
  return (
    <select
      aria-label={label}
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-12 w-full appearance-none rounded-md bg-card px-4 text-base font-semibold text-ink ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-ink"
    >
      {options.map((t) => (
        <option key={t} value={t}>{formatTime(t)}</option>
      ))}
    </select>
  );
}
