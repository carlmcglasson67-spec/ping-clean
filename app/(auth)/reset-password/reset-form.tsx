"use client";

import { useActionState } from "react";
import { Button, PasswordField } from "@/components/ui";
import { Notice } from "../_components/auth-frame";
import { setNewPassword, type ResetState } from "./actions";

export function ResetForm({ email, isNew = false, next }: { email: string; isNew?: boolean; next?: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(setNewPassword, {});
  return (
    <form action={action} className="grid gap-6" noValidate>
      {state.error ? <Notice>{state.error}</Notice> : null}
      {/* Lets password managers save the new password against the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      {next ? <input type="hidden" name="next" value={next.slice(0, 512)} /> : null}
      <PasswordField label={isNew ? "Choose a password" : "New password"} autoComplete="new-password" rules email={email} error={state.fieldError} />
      <Button type="submit" size="lg" pending={pending} className="w-full">
        {pending ? "Saving…" : isNew ? "Save my password" : "Save my new password"}
      </Button>
    </form>
  );
}
