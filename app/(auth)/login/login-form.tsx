"use client";

import { useActionState } from "react";
import { Button, Field, PasswordField, Turnstile } from "@/components/ui";
import { authCaptchaSiteKey } from "@/lib/auth/captcha";
import { Notice } from "../_components/auth-frame";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  const siteKey = authCaptchaSiteKey();

  return (
    <form action={action} className="grid gap-6" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.error ? (
        <Notice>{state.error}</Notice>
      ) : null}

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        defaultValue={state.email}
        error={state.fieldErrors?.email}
      />
      <PasswordField label="Password" autoComplete="current-password" error={state.fieldErrors?.password} />
      {siteKey ? <Turnstile siteKey={siteKey} theme="light" error={state.fieldErrors?.captcha} resetOn={state} /> : null}

      <Button type="submit" size="lg" pending={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
