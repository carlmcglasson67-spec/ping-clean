import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { refreshPaymentsStatus } from "@/lib/stripe/actions";

// Stripe sends the cleaner here when they leave its form (finished or not). Coming back
// proves nothing by itself: Ping asks Stripe what the account can do, then shows that.
export const dynamic = "force-dynamic";

export async function GET() {
  await requireRole("cleaner", "/work/payments");
  await refreshPaymentsStatus();
  redirect("/work/payments?back=1");
}
