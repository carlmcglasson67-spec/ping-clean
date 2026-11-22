import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { cookies } from "next/headers";
import { canChooseNewPassword, RESET_COOKIE, resetPassSecret } from "@/lib/auth/recovery";
import { getSession } from "@/lib/auth/session";
import { AuthFrame, FormIntro, Notice } from "../_components/auth-frame";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false },
};

/** Reached only from a reset email: the session a reset link created, within 15 minutes (lib/auth/recovery.ts). */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ first?: string; next?: string }> }) {
  const [session, jar, { first, next }] = await Promise.all([getSession(), cookies(), searchParams]);
  // A brand-new account choosing its first password (?first=1, words only: the pass is the guard).
  const isNew = first === "1";
  const ready = canChooseNewPassword(jar.get(RESET_COOKIE)?.value, session, resetPassSecret());

  return (
    <AuthFrame
      eyebrow={isNew ? "Your password" : "New password"}
      statement={
        <>
          Nearly done.
          <br />
          <span className="text-brand-gradient-navy">Pick a good one.</span>
        </>
      }
      lede="A few words you'll remember, with a number, beats a short jumble you won't."
    >
      {ready ? (
        <>
          <FormIntro title={isNew ? "Choose your password" : "Choose a new password"}>
            For <strong className="font-semibold text-navy">{session!.email}</strong>. You&rsquo;ll stay signed in afterwards.
          </FormIntro>
          <ResetForm email={session!.email ?? ""} isNew={isNew} next={isNew ? next : undefined} />
        </>
      ) : (
        <div className="grid gap-6" data-testid="reset-expired">
          <FormIntro title="That link has run out" />
          <Notice>
            {isNew
              ? "Your account is set up, but there's a short time limit for choosing the password. Ask for a link to choose it now."
              : "Reset links work once, for a short time. Ask for a new one and open it straight away."}
          </Notice>
          <div>
            <ButtonLink href="/forgot-password" size="lg">
              Send me a new link
            </ButtonLink>
          </div>
        </div>
      )}
    </AuthFrame>
  );
}
