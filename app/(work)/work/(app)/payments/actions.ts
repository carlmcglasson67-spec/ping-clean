"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireRole } from "@/lib/auth/session";
import { startPaymentsSetup } from "@/lib/stripe/actions";

export type SetupState = { error?: string };

/** "Set up payments": straight to Stripe's own form, for this cleaner's own account only. */
export async function openStripe(): Promise<SetupState> {
  await requireRole("cleaner", "/work/payments");
  const r = await startPaymentsSetup();
  if (!r.ok) return { error: r.error };
  redirect(r.url as Route); // Stripe's address, made on the server from Stripe's own answer
}
