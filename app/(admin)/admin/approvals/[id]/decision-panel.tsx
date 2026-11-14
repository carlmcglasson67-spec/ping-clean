"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button, NavyPanel } from "@/components/ui";
import type { Enums } from "@/lib/db/types";
import { TIER } from "@/lib/labels";
import type { ActionResult } from "../../_lib/errors";
import { NOT_SAVED } from "../../_lib/errors";
import type { DecisionInput } from "../_lib/vetting";
import { decideCleaner } from "../actions";

type Status = Enums<"cleaner_status">;
type Tier = Enums<"cleaner_tier">;
type Mode = DecisionInput["decision"];

const TIERS: Tier[] = ["new", "approved", "top"];

/** What each choice asks for and says, in the words the team reads before confirming. */
const COPY: Record<Mode, { open: string; confirm: string; lede: string; why: string; whyRequired: boolean }> = {
  approve: {
    open: "Approve",
    confirm: "Approve and let them work",
    lede: "They'll see jobs in their areas straight away, in the order their tier allows.",
    why: "A note for the team (optional)",
    whyRequired: false,
  },
  decline: {
    open: "Decline",
    confirm: "Decline this applicant",
    lede: "Their application closes. Ping doesn't message them: let them know yourself.",
    why: "Why are they being declined? Only the team sees this.",
    whyRequired: true,
  },
  suspend: {
    open: "Suspend",
    confirm: "Suspend this cleaner",
    lede: "They lose jobs and customers' addresses at once. Every block they hold is flagged on the overview straight away: give each to another cleaner or end it, and tell the customer.",
    why: "Why are they being suspended? Only the team sees this.",
    whyRequired: true,
  },
  reactivate: {
    open: "Reactivate",
    confirm: "Put them back to work",
    lede: "All four checks must still be verified and in date.",
    why: "A note for the team (optional)",
    whyRequired: false,
  },
  tier: {
    open: "Change tier",
    confirm: "Change tier",
    lede: "Their tier decides how early they see new jobs.",
    why: "Why is their tier changing? Only the team sees this.",
    whyRequired: true,
  },
};

/**
 * The decision: approve with a tier, decline, change tier, suspend, reactivate.
 * One choice opens at a time, says what will happen, and asks once before it's done. The
 * database decides (the four checks, who's asking, whether the move fits) and logs it.
 */
export function DecisionPanel({ cleanerId, status, tier, ready, waiting }: { cleanerId: string; status: Status; tier: Tier; ready: boolean; waiting: string[] }) {
  const router = useRouter();
  const whyId = useId();
  const [mode, setMode] = useState<Mode | null>(null);
  const [chosen, setChosen] = useState<Tier>(status === "applicant" ? "new" : tier);
  const [why, setWhy] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const choices: Mode[] = status === "applicant" ? ["approve", "decline"] : status === "active" ? ["tier", "suspend"] : status === "suspended" ? ["reactivate"] : [];
  const blocked = (m: Mode) => (m === "approve" || m === "reactivate") && !ready;

  const open = (m: Mode) => {
    setMode(m);
    setWhy("");
    setChosen(status === "applicant" ? "new" : tier);
    setResult(null);
  };

  const submit = () => {
    if (!mode) return;
    const input: DecisionInput =
      mode === "approve"
        ? { decision: "approve", cleanerId, tier: chosen, note: why }
        : mode === "tier"
          ? { decision: "tier", cleanerId, tier: chosen, reason: why }
          : mode === "reactivate"
            ? { decision: "reactivate", cleanerId, note: why }
            : { decision: mode, cleanerId, reason: why };
    start(async () => {
      let r: ActionResult;
      try {
        r = await decideCleaner(input);
      } catch {
        r = { ok: false, message: NOT_SAVED };
      }
      setResult(r);
      if (r.ok) {
        setMode(null);
        setWhy("");
        router.refresh();
      }
    });
  };

  const copy = mode ? COPY[mode] : null;
  const sameTier = mode === "tier" && chosen === tier;

  return (
    <NavyPanel className="grid gap-5 p-6 pb-14 sm:p-7 sm:pb-16">
      <h2 className="text-lg font-semibold">Decision</h2>

      {status === "applicant" ? (
        <p className="text-on-navy-2">
          {ready ? "All four checks are verified and in date. Ready to approve." : `Not ready to approve: waiting on ${waiting.join(", ")}.`}
        </p>
      ) : status === "left" ? (
        <p className="text-on-navy-2">This person isn&rsquo;t with Ping. There&rsquo;s nothing to decide here.</p>
      ) : (
        <p className="text-on-navy-2">
          Tier now: <span className="font-semibold text-on-navy">{TIER[tier]}</span>.
          {status === "suspended" && !ready ? ` Can't go back to work yet: waiting on ${waiting.join(", ")}.` : ""}
        </p>
      )}

      {!mode && choices.length ? (
        <div className="flex flex-wrap gap-3">
          {choices.map((m) => (
            <Button key={m} variant={m === "approve" || m === "reactivate" ? "signal" : "onNavy"} disabled={pending || blocked(m)} onClick={() => open(m)}>
              {COPY[m].open}
            </Button>
          ))}
        </div>
      ) : null}

      {mode && copy ? (
        <form
          className="grid gap-4 border-t border-line-navy pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-sm text-on-navy-2">{copy.lede}</p>

          {mode === "approve" || mode === "tier" ? (
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-semibold">{mode === "approve" ? "Start them at" : "New tier"}</legend>
              <div className="flex flex-wrap gap-2">
                {TIERS.map((t) => (
                  <label
                    key={t}
                    className={
                      "inline-flex min-h-12 cursor-pointer items-center rounded-full px-5 text-sm font-semibold ring-1 ring-inset transition-colors has-focus-visible:ring-2 has-focus-visible:ring-teal-glow " +
                      (chosen === t ? "bg-teal text-navy ring-teal" : "bg-white/8 text-on-navy ring-white/25 hover:ring-teal/70")
                    }
                  >
                    <input type="radio" name="tier" value={t} checked={chosen === t} onChange={() => setChosen(t)} className="sr-only" />
                    {TIER[t]}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="grid gap-2">
            <label htmlFor={whyId} className="text-sm font-semibold">{copy.why}</label>
            <textarea
              id={whyId}
              required={copy.whyRequired}
              maxLength={300}
              rows={3}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              className="w-full rounded-md bg-white/8 px-4 py-3 text-base text-on-navy ring-1 ring-inset ring-white/25 placeholder:text-on-navy-3 focus:outline-none focus:ring-2 focus:ring-teal-glow"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant={mode === "decline" || mode === "suspend" ? "danger" : "signal"} pending={pending} disabled={pending || sameTier}>
              {copy.confirm}
            </Button>
            <Button type="button" variant="onNavy" disabled={pending} onClick={() => { setMode(null); setResult(null); }}>
              Cancel
            </Button>
          </div>
          {sameTier ? <p className="text-sm text-on-navy-3">They&rsquo;re already {TIER[tier]}. Choose a different tier.</p> : null}
        </form>
      ) : null}

      {result ? (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-sm font-semibold text-ok-on-navy" : "text-sm font-semibold text-bad-on-navy"}>
          {result.message}
        </p>
      ) : null}

      <p className="text-sm text-on-navy-3">Every decision is checked by the database and logged with your name and the reason.</p>
    </NavyPanel>
  );
}
