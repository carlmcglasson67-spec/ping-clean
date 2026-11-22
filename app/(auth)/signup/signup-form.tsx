"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, Turnstile } from "@/components/ui";
import { authCaptchaSiteKey } from "@/lib/auth/captcha";
import { Notice } from "../_components/auth-frame";
import { resendConfirmation, signUp, type ResendState, type SignupState } from "./actions";

export function SignupForm({ next, signInHref }: { next?: string; signInHref: string }) {
  const [state, action, pending] = useActionState<SignupState, FormData>(signUp, {});
  const siteKey = authCaptchaSiteKey();

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
        error={fe.email}
      />
      <p className="text-base text-navy-2">
        We&rsquo;ll email you a link. Open it to choose your password, add a phone number if you like, and agree to the{" "}
        <Link href="/terms" target="_blank" className="font-semibold text-blue underline underline-offset-4">
          terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" target="_blank" className="font-semibold text-blue underline underline-offset-4">
          privacy notice
        </Link>
        . We only use your email to send that link until then.
      </p>

      {siteKey ? <Turnstile siteKey={siteKey} theme="light" error={fe.captcha} resetOn={state} /> : null}

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
  const siteKey = authCaptchaSiteKey();
  return (
    <div className="grid gap-6" data-testid="check-email">
      <Notice tone="ok">Nearly there. Check your email.</Notice>
      <p className="text-lg text-navy-2">
        We&rsquo;ve sent a link to <strong className="font-semibold text-navy">{email}</strong>. Open it on this phone or any other device,
        then choose your password. The link expires, so open it soon.
      </p>
      <p className="text-navy-2">Nothing there after a few minutes? Check your junk or spam folder, then send it again.</p>
      <form action={action} className="grid gap-3">
        <input type="hidden" name="email" value={email} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {siteKey ? <Turnstile siteKey={siteKey} theme="light" error={state.captcha} resetOn={state} /> : null}
        <Button type="submit" variant="secondary" size="lg" pending={pending} className="w-full">
          Send it again
        </Button>
        {state.captcha && !siteKey ? <p role="alert" className="text-base font-medium text-bad">{state.captcha}</p> : null}
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
