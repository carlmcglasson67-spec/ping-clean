"use client";

import { useActionState } from "react";
import { Button, PasswordField } from "@/components/ui";
import { Notice } from "../_components/auth-frame";
import { setNewPassword, type ResetState } from "./actions";

export function ResetForm({ email, invited = false }: { email: string; invited?: boolean }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(setNewPassword, {});
  return (
    <form action={action} className="grid gap-6" noValidate>
      {state.error ? <Notice>{state.error}</Notice> : null}
      {/* Lets password managers save the new password against the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <PasswordField label={invited ? "Your password" : "New password"} autoComplete="new-password" rules email={email} error={state.fieldError} />
      <Button type="submit" size="lg" pending={pending} className="w-full">
        {pending ? "Saving…" : invited ? "Save my password" : "Save my new password"}
      </Button>
    </form>
  );
}
