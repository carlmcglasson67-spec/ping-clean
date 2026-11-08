import { PING_ERRORS } from "@/lib/db/errors";

export type ClaimFailure = "taken" | "gone" | "no-dates" | "blocked" | "retry";
export type ClaimResult = { ok: true } | { ok: false; reason: ClaimFailure };

/**
 * What claim_series() said, as something a cleaner can act on. Its error codes:
 *   PC001 not your offer · PC002 someone else got it · PC003 no longer open to you
 *   (including a block the Ping team has ended) · PC004 no cleans left on its dates
 *   42501 not an active cleaner
 * Anything else (no signal, a timeout) is worth another tap.
 */
export function claimOutcome(code: string | undefined | null): ClaimResult {
  switch (code) {
    case "PC002":
      return { ok: false, reason: "taken" };
    case "PC001":
    case "PC003":
    case "PC005":
      return { ok: false, reason: "gone" };
    case "PC004":
      return { ok: false, reason: "no-dates" };
    case "42501":
      return { ok: false, reason: "blocked" };
    default:
      return { ok: false, reason: "retry" };
  }
}

/** Titles come from lib/db/errors.ts, so every app says the same thing for the same code. */
export const CLAIM_COPY: Record<ClaimFailure, { title: string; body: string }> = {
  taken: { title: PING_ERRORS.PC002, body: "It went moments ago. New jobs in your areas will show up here." },
  gone: { title: PING_ERRORS.PC003, body: "Your areas or days may have changed, or the Ping team took it off the board." },
  "no-dates": { title: PING_ERRORS.PC004, body: "None of its cleans fit before the customer's next booking now. The Ping office will sort it out." },
  blocked: { title: "Your account can't claim jobs right now.", body: "Call the Ping office and we'll sort it out." },
  retry: { title: "That didn't go through.", body: "Your signal may have dropped. Tap Claim again: you can't claim it twice." },
};
