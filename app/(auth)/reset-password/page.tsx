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

/**
 * Reached only from a reset or invite email: the session that link created, within 15
 * minutes (lib/auth/recovery.ts). `?invited=1` (set after an invite link, issue #21 note 3)
 * only changes the words: the pass check is the same.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ invited?: string }> }) {
  const [session, jar, { invited: invitedParam }] = await Promise.all([getSession(), cookies(), searchParams]);
  const ready = canChooseNewPassword(jar.get(RESET_COOKIE)?.value, session, resetPassSecret());
  const invited = invitedParam === "1";

  return (
    <AuthFrame
      eyebrow={invited ? "Welcome to Ping" : "New password"}
      statement={
        <>
          {invited ? "Last step." : "Nearly done."}
          <br />
          <span className="text-brand-gradient-navy">Pick a good one.</span>
        </>
      }
      lede="A few words you'll remember, with a number, beats a short jumble you won't."
    >
      {ready ? (
        <>
          <FormIntro title={invited ? "Choose your password" : "Choose a new password"}>
            For <strong className="font-semibold text-navy">{session!.email}</strong>.{" "}
            {invited ? "It\u2019s what you\u2019ll sign in with from now on. You\u2019ll stay signed in afterwards." : "You\u2019ll stay signed in afterwards."}
          </FormIntro>
          <ResetForm email={session!.email ?? ""} invited={invited} />
        </>
      ) : (
        <div className="grid gap-6" data-testid="reset-expired">
          <FormIntro title="That link has run out" />
          <Notice>
            {invited
              ? "Invitation links work once, for a short time. Ask for a password link with the same email address and open it straight away."
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
