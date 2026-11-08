"use server";

// Register interest: the Server Actions Track A's forms call, one per place the form
// appears, so the source is set here and never sent by the browser. Use with useActionState:
//
//   const [state, action] = useActionState(registerInterestOnHoldingPage, initialInterestState);
//   <form action={action}> … </form>
//
// Order: honeypot → field checks → Turnstile (if switched on) → public.register_interest.
// This is the ONLY way onto the list: the database function is granted to the service role
// alone, so nobody can call it directly and skip these checks (PR #20 review, BLOCK 1).
// The server sets the source, the consent version and (in the database) the kind.
import { createAdminClient } from "@/lib/db/admin";
import { isPingError, pingErrorMessage } from "@/lib/db/errors";
import { hasSupabaseEnv } from "@/lib/env";
import { INTEREST_FIELDS, parseInterestForm, type InterestSource, type RegisterInterestState } from "./form";
import { verifyTurnstile } from "./turnstile";

const TRY_AGAIN = "Something went wrong. Please try again.";

/** On the instant-price result, when the postcode is outside the launch area. */
export async function registerInterestOnInstantPrice(_prev: RegisterInterestState, formData: FormData): Promise<RegisterInterestState> {
  return register("instant_price", formData);
}

/** On the holding page, while booking isn't open yet. */
export async function registerInterestOnHoldingPage(_prev: RegisterInterestState, formData: FormData): Promise<RegisterInterestState> {
  return register("holding_page", formData);
}

async function register(source: InterestSource, formData: FormData): Promise<RegisterInterestState> {
  // Bots that fill the hidden field get the normal reply, and nothing is stored.
  const honeypot = formData.get(INTEREST_FIELDS.honeypot);
  if (typeof honeypot === "string" && honeypot.length > 0) return { status: "thanks" };

  const parsed = parseInterestForm(formData, source);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.fieldErrors, values: parsed.values };

  const token = formData.get(INTEREST_FIELDS.turnstile);
  const check = await verifyTurnstile(typeof token === "string" ? token : null);
  if (check === "failed") {
    return { status: "error", values: parsed.values, fieldErrors: { captcha: "Please complete the check and send it again." } };
  }
  if (check === "unavailable") return { status: "error", values: parsed.values, message: TRY_AGAIN };

  if (!hasSupabaseEnv()) return { status: "error", values: parsed.values, message: TRY_AGAIN };
  let error: { code?: string | null } | null;
  try {
    // Service role, server only: the one caller register_interest accepts.
    ({ error } = await createAdminClient().rpc("register_interest", parsed.args));
  } catch {
    return { status: "error", values: parsed.values, message: TRY_AGAIN };
  }
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
