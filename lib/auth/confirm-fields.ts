import { z } from "zod";

/**
 * The fields /auth/confirm posts, checked before anything reaches Supabase (re-review N7).
 *   token_hash + type   the recommended email templates (work on any device)
 *   code                the default PKCE link (only in the browser that asked for it)
 */
export const confirmFields = z
  .object({
    token_hash: z.string().regex(/^[A-Za-z0-9_-]{8,512}$/).optional(),
    // email covers sign-up and magic links; invite and email_change come from those templates.
    type: z.enum(["signup", "email", "recovery", "invite", "email_change"]).optional(),
    code: z.string().regex(/^[A-Za-z0-9_-]{8,512}$/).optional(),
    next: z.string().max(512).optional(),
    flow: z.enum(["signup", "reset"]).optional(),
  })
  .strict()
  .refine((f) => Boolean((f.token_hash && f.type) || f.code), { message: "incomplete link" });

export type ConfirmFields = z.infer<typeof confirmFields>;

/** Reads the form: empty or non-text fields count as missing. */
export function parseConfirmForm(fd: FormData) {
  const get = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  return confirmFields.safeParse({ token_hash: get("token_hash"), type: get("type"), code: get("code"), next: get("next"), flow: get("flow") });
}
