import { Badge, Button, NavyPanel } from "@/components/ui";
import type { Enums } from "@/lib/db/types";
import { TIER } from "@/lib/labels";

/**
 * The decision: approve with a tier, decline, change tier, suspend, reactivate.
 *
 * Switched off until shared request C-1 lands: the cleaners table (rightly) can't be
 * changed from the browser, and there's no admin function for it yet. Shown anyway, with
 * the reason, so the team sees what's coming and where an applicant stands.
 */
export function DecisionPanel({ status, tier, ready, waiting }: { status: Enums<"cleaner_status">; tier: Enums<"cleaner_tier">; ready: boolean; waiting: string[] }) {
  const actions =
    status === "applicant" ? ["Approve", "Decline"] : status === "active" ? ["Change tier", "Suspend"] : status === "suspended" ? ["Reactivate"] : [];

  return (
    <NavyPanel className="grid gap-5 p-6 pb-14 sm:p-7 sm:pb-16">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">Decision</h2>
        <Badge tone="warn">Not switched on yet</Badge>
      </div>
      {status === "applicant" ? (
        <p className="text-on-navy-2">
          {ready ? "All four checks are verified and in date. Ready to approve." : `Not ready: waiting on ${waiting.join(", ")}.`}
        </p>
      ) : (
        <p className="text-on-navy-2">Tier now: <span className="font-semibold text-on-navy">{TIER[tier]}</span>.</p>
      )}
      {actions.length ? (
        <div className="flex flex-wrap gap-3">
          {actions.map((a) => (
            <Button key={a} variant="onNavy" disabled>
              {a}
            </Button>
          ))}
        </div>
      ) : null}
      <p className="text-sm text-on-navy-3">
        Approving, tiers and suspending need one new database function (shared request C-1), so the decision is checked and logged by the database, not the page. Until then, documents can be verified and sent back here.
      </p>
    </NavyPanel>
  );
}
