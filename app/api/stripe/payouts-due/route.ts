import { jobRequestAllowed, jobSecret } from "@/lib/stripe/charges";
import { runPayoutJob } from "@/lib/stripe/payouts";

// The payout job (payments PR 9). The database's cron calls this (private.kick_payout_job)
// with the shared secret PING_JOB_SECRET, the same one the charge job uses. Nobody else can:
// no secret configured → 503; a wrong one → 401. It takes no input: who is due, and every
// amount, comes from the database. See lib/stripe/payouts.ts.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(request: Request) {
  const secret = jobSecret();
  if (!secret) return json(503, { error: "not configured" });
  if (!jobRequestAllowed(request.headers.get("authorization"), secret)) return json(401, { error: "not allowed" });
  try {
    return json(200, await runPayoutJob());
  } catch {
    console.error("payout job: the run couldn't start");
    return json(500, { error: "try again" });
  }
}
