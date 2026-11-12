import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { startPaymentsSetup } from "@/lib/stripe/actions";

// Stripe sends the cleaner here when a set-up link has expired or was already used. A fresh
// link is made for their own account and they carry straight on.
export const dynamic = "force-dynamic";

export async function GET() {
  await requireRole("cleaner", "/work/payments");
  const r = await startPaymentsSetup();
  redirect((r.ok ? r.url : "/work/payments?retry=1") as Route);
}
