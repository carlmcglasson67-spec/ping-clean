"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Checkbox, Field, PasswordField } from "@/components/ui";
import { Notice } from "../_components/auth-frame";
import { setNewPassword, type ResetState } from "./actions";

/**
 * A new password, or for a brand-new account (isNew) the first one, with the details that
 * only the address's owner should give: their name (checked), phone and consent (#60).
 */
export function ResetForm({ email, isNew = false, invited = false, next, name }: { email: string; isNew?: boolean; invited?: boolean; next?: string; name?: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(setNewPassword, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-6" noValidate>
      {state.error ? <Notice>{state.error}</Notice> : null}
      {/* Lets password managers save the new password against the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      {next ? <input type="hidden" name="next" value={next.slice(0, 512)} /> : null}
      {isNew ? (
        <Field
          label="Your name"
          name="fullName"
          autoComplete="name"
          required
          defaultValue={name}
          hint="As it should appear to your cleaner. Change it if it isn't right."
          error={fe.fullName}
        />
      ) : null}
      <PasswordField
        label={isNew ? "Choose a password" : invited ? "Your password" : "New password"}
        autoComplete="new-password"
        rules
        email={email}
        error={isNew ? fe.password : state.fieldError}
      />
      {isNew ? (
        <>
          <Field
            label="Mobile number (optional)"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            hint="So your cleaner or the Ping team can reach you on the day. We never share it for marketing."
            error={fe.phone}
          />
          <div className="grid gap-3">
            <Checkbox name="terms" required error={fe.terms}>
              I agree to Ping&rsquo;s{" "}
              <Link href="/terms" target="_blank" className="font-semibold text-blue underline underline-offset-4">
                terms of use
              </Link>
              .
            </Checkbox>
            <Checkbox name="privacy" required error={fe.privacy}>
              I&rsquo;ve read the{" "}
              <Link href="/privacy" target="_blank" className="font-semibold text-blue underline underline-offset-4">
                privacy notice
              </Link>
              , which explains what Ping keeps about me and why.
            </Checkbox>
          </div>
        </>
      ) : null}
      <Button type="submit" size="lg" pending={pending} className="w-full">
        {pending ? "Saving…" : isNew ? "Save and continue" : invited ? "Save my password" : "Save my new password"}
      </Button>
    </form>
  );
}
