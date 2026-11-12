import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/db/admin";
import { requireSiteUrl } from "@/lib/env";
import { getStripe } from "./server";

// Cleaners' payments set-up (payments PR 5): Stripe Connect Express, TEST mode only.
// Each cleaner gets one connected account. Stripe's own form collects their ID and bank
// details; Ping never sees or stores them. Ping keeps only the account id (server only)
// and what Stripe says the account can do.

const ACCOUNT_ID = /^acct_[A-Za-z0-9]{6,64}$/;

/** Where Stripe sends the cleaner afterwards. Both are Ping's own pages, built on the server. */
export const SETUP_PATHS = { done: "/work/payments/return", again: "/work/payments/continue" } as const;

/**
 * The cleaner's one Stripe account: made the first time they start set-up, then reused.
 * Idempotent on Stripe's side (key cleaner:<id>:account), and the database keeps the first
 * id if two taps race. Payouts are manual, so cleared earnings wait in the cleaner's Stripe
 * balance until Ping releases them after the dispute window (ping-money-rules 4).
 */
export async function ensureCleanerAccount(cleaner: { id: string; email: string | null }): Promise<string> {
  const db = createAdminClient();
  const known = await db.rpc("stripe_cleaner_account_for", { p_cleaner: cleaner.id });
  if (known.error) throw new Error("couldn't read the cleaner's account");
  if (typeof known.data === "string" && known.data) return known.data;

  const account = await getStripe().accounts.create(
    {
      type: "express",
      country: "GB",
      default_currency: "gbp",
      business_type: "individual",
      ...(cleaner.email ? { email: cleaner.email } : {}),
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { mcc: "7349", product_description: "Domestic cleaning for customers introduced by Ping Clean." },
      settings: { payouts: { schedule: { interval: "manual" } } },
      metadata: { profile_id: cleaner.id },
    },
    { idempotencyKey: `cleaner:${cleaner.id}:account` },
  );
  const kept = await db.rpc("stripe_link_cleaner_account", { p_cleaner: cleaner.id, p_account: account.id });
  if (kept.error || typeof kept.data !== "string") throw new Error("couldn't save the cleaner's account");
  return kept.data;
}

/**
 * A fresh link to Stripe's set-up form. Links are single use and short lived, so a new one
 * is made every time (no idempotency key). The same link serves starting, carrying on and
 * giving Stripe anything more it asks for later.
 */
export async function createSetupLink(accountId: string): Promise<string> {
  const site = requireSiteUrl();
  const link = await getStripe().accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    return_url: `${site}${SETUP_PATHS.done}`,
    refresh_url: `${site}${SETUP_PATHS.again}`,
    collection_options: { fields: "eventually_due" }, // ask once, up front, not again mid-block
  });
  const url = new URL(link.url);
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("unexpected set-up link");
  return link.url;
}

/**
 * Reads the account from Stripe itself and stores what it can do. Used by the webhook and
 * when a cleaner comes back from Stripe's form (the webhook may not have arrived yet).
 * "Ready" needs both: taking card payments and paying out to their bank.
 */
export async function syncAccountStatus(accountId: string): Promise<"updated" | "unknown_account"> {
  if (!ACCOUNT_ID.test(accountId)) return "unknown_account";
  let a: Stripe.Account;
  try {
    a = await getStripe().accounts.retrieve(accountId);
  } catch (e) {
    // Not an account Ping can see (never Ping's, or disconnected): retrying would never work.
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 403 || status === 404) return "unknown_account";
    throw e; // anything else (Stripe down, rate limit): the webhook is retried
  }
  const due = (a.requirements?.currently_due?.length ?? 0) + (a.requirements?.past_due?.length ?? 0) > 0;
  const saved = await createAdminClient().rpc("stripe_account_status", {
    p_account: a.id,
    p_charges_enabled: a.charges_enabled === true,
    p_payouts_enabled: a.payouts_enabled === true,
    p_details_submitted: a.details_submitted === true,
    p_requirements_due: due,
  });
  if (saved.error) throw new Error("couldn't save the account's status");
  return saved.data === "updated" ? "updated" : "unknown_account";
}

/**
 * account.updated (Connect endpoint). The account id comes from the signed event; its state
 * is then read fresh from Stripe, so an old event arriving late can't undo a newer one.
 * An account Ping never linked to a cleaner stores nothing and isn't retried.
 */
export async function onAccountUpdated(event: Stripe.Event): Promise<void> {
  const account = (event as { account?: string }).account;
  const object = event.data.object as { id?: string };
  if (!account || object.id !== account) {
    console.warn(`stripe: account.updated ${event.id} doesn't name its own account; ignored`);
    return;
  }
  const outcome = await syncAccountStatus(account); // a failure throws: Stripe retries
  if (outcome !== "updated") console.warn(`stripe: account.updated ${event.id}: not a cleaner's account; nothing stored`);
}

/**
 * account.application.deauthorized: the account has been disconnected from Ping, so it
 * can't be charged to or paid out any more. Marked not ready at once (Stripe would refuse a
 * read of it now); the cleaner is asked to set up payments again.
 */
export async function onAccountDeauthorized(event: Stripe.Event): Promise<void> {
  const account = (event as { account?: string }).account;
  if (!account || !ACCOUNT_ID.test(account)) return;
  const saved = await createAdminClient().rpc("stripe_account_status", {
    p_account: account, p_charges_enabled: false, p_payouts_enabled: false, p_details_submitted: false, p_requirements_due: true,
  });
  if (saved.error) throw new Error("couldn't save the account's status");
}
