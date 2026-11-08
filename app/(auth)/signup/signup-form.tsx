"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, Checkbox, Field, PasswordField } from "@/components/ui";
import { Notice } from "../_components/auth-frame";
import { resendConfirmation, signUp, type ResendState, type SignupState } from "./actions";

export function SignupForm({ next, signInHref }: { next?: string; signInHref: string }) {
  const [state, action, pending] = useActionState<SignupState, FormData>(signUp, {});
  const [email, setEmail] = useState(state.values?.email ?? "");

  if (state.sent) return <CheckEmail email={state.sent.email} next={next} />;
  const fe = state.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-6" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {/* Honeypot: hidden from people and screen readers; bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Company
          <input type="text" name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      {state.error ? <Notice>{state.error}</Notice> : null}

      <Field label="Your name" name="fullName" autoComplete="name" required defaultValue={state.values?.fullName} error={fe.fullName} />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        defaultValue={state.values?.email}
        onChange={(e) => setEmail(e.target.value)}
        error={fe.email}
      />
      <PasswordField label="Create a password" autoComplete="new-password" rules email={email} error={fe.password} />
      <Field
        label="Mobile number (optional)"
        name="phone"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        defaultValue={state.values?.phone}
        hint="So your cleaner or the Ping team can reach you on the day. We never share it for marketing."
        error={fe.phone}
      />

      <div className="grid gap-3 pt-2">
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

      <Button type="submit" size="lg" pending={pending} className="mt-2 w-full">
        {pending ? "Creating your account…" : "Create my account"}
      </Button>
      <p className="text-center text-base text-navy-2">
        Already with Ping?{" "}
        <Link href={signInHref as "/login"} className="font-semibold text-blue underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

function CheckEmail({ email, next }: { email: string; next?: string }) {
  const [state, action, pending] = useActionState<ResendState, FormData>(resendConfirmation, {});
  return (
    <div className="grid gap-6" data-testid="check-email">
      <Notice tone="ok">Nearly there. Check your email.</Notice>
      <p className="text-lg text-navy-2">
        We&rsquo;ve sent a link to <strong className="font-semibold text-navy">{email}</strong>. Open it on this phone or any other device
        to finish setting up your account. The link expires, so open it soon.
      </p>
      <p className="text-navy-2">Nothing there after a few minutes? Check your junk or spam folder, then send it again.</p>
      <form action={action} className="grid gap-3">
        <input type="hidden" name="email" value={email} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Button type="submit" variant="secondary" size="lg" pending={pending} className="w-full">
          Send it again
        </Button>
        {state.done ? <p role="status" className="text-sm text-teal-ink">If that address can have an account, a fresh link is on its way.</p> : null}
      </form>
      <p className="text-sm text-navy-3">
        Wrong address?{" "}
        <a href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-blue underline-offset-4 hover:underline">
          Start again
        </a>
      </p>
    </div>
  );
}
