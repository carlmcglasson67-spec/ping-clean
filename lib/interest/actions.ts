"use server";

// Register interest: the Server Action Track A's form calls. Use it with useActionState:
//
//   const [state, action] = useActionState(registerInterest, initialInterestState);
//   <form action={action}> … </form>
//
// Order: honeypot → field checks → Turnstile (if switched on) → public.register_interest.
// Runs as the visitor (anon key, or their session), never the service role.
import { createClient } from "@/lib/db/server";
import { isPingError, pingErrorMessage } from "@/lib/db/errors";
import { hasSupabaseEnv } from "@/lib/env";
import { INTEREST_FIELDS, parseInterestForm, type RegisterInterestState } from "./form";
import { verifyTurnstile } from "./turnstile";

const TRY_AGAIN = "Something went wrong. Please try again.";

export async function registerInterest(_prev: RegisterInterestState, formData: FormData): Promise<RegisterInterestState> {
  // Bots that fill the hidden field get the normal reply, and nothing is stored.
  const honeypot = formData.get(INTEREST_FIELDS.honeypot);
  if (typeof honeypot === "string" && honeypot.length > 0) return { status: "thanks" };

  const parsed = parseInterestForm(formData);
  if (!parsed.ok) {
    // A missing or unknown source is the page's mistake, not the person's.
    return { status: "error", fieldErrors: parsed.fieldErrors, values: parsed.values, message: parsed.badSource ? TRY_AGAIN : undefined };
  }

  const token = formData.get(INTEREST_FIELDS.turnstile);
  const check = await verifyTurnstile(typeof token === "string" ? token : null);
  if (check === "failed") {
    return { status: "error", values: parsed.values, fieldErrors: { captcha: "Please complete the check and send it again." } };
  }
  if (check === "unavailable") return { status: "error", values: parsed.values, message: TRY_AGAIN };

  if (!hasSupabaseEnv()) return { status: "error", values: parsed.values, message: TRY_AGAIN };
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_interest", parsed.args);
  if (!error) return { status: "thanks" };

  // Never log the postcode or contact details (ping-data-security rule 5).
  const fieldErrors =
    error.code === "PC030" ? { postcode: pingErrorMessage(error) }
    : error.code === "PC031" ? { [parsed.values.contact]: pingErrorMessage(error) }
    : undefined;
  return {
    status: "error",
    values: parsed.values,
    fieldErrors,
    message: fieldErrors ? undefined : isPingError(error) ? pingErrorMessage(error) : TRY_AGAIN,
  };
}
