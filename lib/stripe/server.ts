import "server-only";
import Stripe from "stripe";
import { apiBase, secretKeyProblem } from "./keys";

let client: Stripe | undefined;

/**
 * The Stripe client, server only. Refuses to start with anything but a test key
 * (sk_test_/rk_test_), so a live key can never be used by mistake. The API version is the
 * one this library release is pinned to (stripe@23.0.1), so Stripe can't change shapes
 * under us.
 */
export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  const problem = secretKeyProblem(key);
  if (problem) throw new Error(problem);
  const base = apiBase();
  client = new Stripe(key!, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: "Ping Clean" },
    ...(base ?? {}),
  });
  return client;
}
