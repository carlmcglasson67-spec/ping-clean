"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field } from "@/components/ui";
import { Notice } from "../_components/auth-frame";
import { requestReset, type ForgotState } from "./actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestReset, {});

  if (state.sent) {
    return (
      <div className="grid gap-6" data-testid="reset-sent">
        <Notice tone="ok">Check your email.</Notice>
        <p className="text-lg text-navy-2">
          If there&rsquo;s a Ping account for <strong className="font-semibold text-navy">{state.sent}</strong>, we&rsquo;ve sent it a link to
          choose a new password. Open it on any device. The link expires, so use it soon.
        </p>
        <p className="text-navy-2">Nothing after a few minutes? Check your junk or spam folder, or make sure it&rsquo;s the address you signed up with.</p>
        <Link href="/login" className="font-semibold text-blue underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-6" noValidate>
      {state.error ? <Notice>{state.error}</Notice> : null}
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
      />
      <Button type="submit" size="lg" pending={pending} className="w-full">
        {pending ? "Sending…" : "Send me a reset link"}
      </Button>
      <p className="text-center text-base text-navy-2">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-blue underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
