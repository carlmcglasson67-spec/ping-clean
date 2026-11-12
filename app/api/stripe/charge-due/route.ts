import { jobRequestAllowed, jobSecret, runChargeJob } from "@/lib/stripe/charges";

// The charge job (payments PR 6). The database's cron calls this every minute when a charge
// is due (private.kick_charge_job), with the shared secret PING_JOB_SECRET. Nobody else can:
// no secret configured → 503; a wrong one → 401. It takes no input: what is due, and every
// amount, comes from the database. See lib/stripe/charges.ts.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(request: Request) {
  const secret = jobSecret();
  if (!secret) return json(503, { error: "not configured" });
  if (!jobRequestAllowed(request.headers.get("authorization"), secret)) return json(401, { error: "not allowed" });
  try {
    return json(200, await runChargeJob());
  } catch {
    console.error("charge job: the run couldn't start");
    return json(500, { error: "try again" });
  }
}
