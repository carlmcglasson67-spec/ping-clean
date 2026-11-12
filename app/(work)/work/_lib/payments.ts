// Where a cleaner is with payments set-up, from the four things Stripe tells Ping
// (cleaners.stripe_*; written only by the server from Stripe itself). Pure, so it's tested.

export type StripeFlags = {
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  stripe_details_submitted: boolean;
  stripe_requirements_due: boolean;
  stripe_status_at: string | null;
};

/**
 *  ready     Stripe can take card payments for them and pay their bank: they can take work
 *  more      Stripe needs something else from them (a document, a bank detail)
 *  checking  the form is in; Stripe is still checking it (nothing for the cleaner to do)
 *  started   they began the form and left before the end
 *  todo      not started
 */
export type PaymentsStep = "ready" | "more" | "checking" | "started" | "todo";

export function paymentsStep(f: StripeFlags | null | undefined): PaymentsStep {
  if (!f) return "todo";
  if (f.stripe_charges_enabled && f.stripe_payouts_enabled) return "ready";
  if (f.stripe_details_submitted) return f.stripe_requirements_due ? "more" : "checking";
  return f.stripe_status_at ? "started" : "todo";
}

/** Same rule as the database's private.cleaner_payable: both, or no work. */
export const canTakeWork = (f: StripeFlags | null | undefined) => paymentsStep(f) === "ready";

export const PAYMENTS_COPY: Record<PaymentsStep, { badge: string; tone: "ok" | "warn" | "bad" | "neutral"; title: string; body: string; action: string | null }> = {
  ready: {
    badge: "Ready",
    tone: "ok",
    title: "You're set up to be paid.",
    body: "Your earnings for each clean go straight to your own Stripe account, then on to your bank once the clean's check period has passed.",
    action: "Update my bank or details",
  },
  more: {
    badge: "Action needed",
    tone: "bad",
    title: "Stripe needs one more thing from you.",
    body: "It's usually a clearer photo of your ID or a bank detail. Until it's done you won't be offered new jobs.",
    action: "Finish with Stripe",
  },
  checking: {
    badge: "Being checked",
    tone: "warn",
    title: "Stripe is checking your details.",
    body: "There's nothing more for you to do. It usually takes a few minutes, sometimes a day or two. New jobs appear as soon as it's done.",
    action: null,
  },
  started: {
    badge: "Not finished",
    tone: "warn",
    title: "Pick up where you left off.",
    body: "Stripe has kept what you've entered so far. Finish the form and you can start taking jobs.",
    action: "Carry on with Stripe",
  },
  todo: {
    badge: "To do",
    tone: "warn",
    title: "Set up how you get paid.",
    body: "One short, secure form with Stripe, the company that handles Ping's payments. You can't be offered jobs until it's done, so there's always somewhere for your money to go.",
    action: "Set up payments",
  },
};

export const STRIPE_COLUMNS = "stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_requirements_due, stripe_status_at" as const;
