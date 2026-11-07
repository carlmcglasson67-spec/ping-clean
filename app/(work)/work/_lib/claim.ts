export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: "taken" | "gone" | "blocked" | "retry" };

/**
 * What claim_series() said, as something a cleaner can act on. Its error codes:
 *   PC001 not your offer · PC002 someone else got it · PC003 no longer open to you
 *   42501 not an active cleaner
 * Anything else (no signal, a timeout) is worth another tap.
 */
export function claimOutcome(code: string | undefined): ClaimResult {
  switch (code) {
    case "PC002":
      return { ok: false, reason: "taken" };
    case "PC001":
    case "PC003":
      return { ok: false, reason: "gone" };
    case "42501":
      return { ok: false, reason: "blocked" };
    default:
      return { ok: false, reason: "retry" };
  }
}

export const CLAIM_COPY: Record<Exclude<ClaimResult, { ok: true }>["reason"], { title: string; body: string }> = {
  taken: { title: "Another cleaner claimed this one first", body: "It went moments ago. New jobs in your areas will show up here." },
  gone: { title: "This job isn't open to you any more", body: "Your areas or days may have changed, or the job was taken off the board." },
  blocked: { title: "Your account can't claim jobs right now", body: "Call the Ping office and we'll sort it out." },
  retry: { title: "That didn't go through", body: "Your signal may have dropped. Tap Claim again: you can't claim it twice." },
};
