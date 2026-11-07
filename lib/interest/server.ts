import "server-only";

// For the Server Component that renders the register-interest form: the numbers and keys
// the form needs, read on the server. Pass the result to the client form as props.
import { createClient } from "@/lib/db/server";
import { hasSupabaseEnv } from "@/lib/env";
import { turnstileSiteKey } from "./turnstile";

export type InterestFormSetup = {
  /** For the consent wording. Null: registering is switched off, so don't show the form. */
  retentionMonths: number | null;
  /** Render the Turnstile widget with this key; null means Turnstile is off. */
  turnstileSiteKey: string | null;
};

export async function interestFormSetup(): Promise<InterestFormSetup> {
  let retentionMonths: number | null = null;
  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("interest_retention_months");
    retentionMonths = typeof data === "number" ? data : null;
  }
  return { retentionMonths, turnstileSiteKey: turnstileSiteKey() };
}
