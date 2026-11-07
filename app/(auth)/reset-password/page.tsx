import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { freshRecovery } from "@/lib/auth/recovery";
import { getSession } from "@/lib/auth/session";
import { AuthFrame, FormIntro, Notice } from "../_components/auth-frame";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false },
};

/** Reached only from a reset email: the session must come from a reset link used in the last 15 minutes. */
export default async function ResetPasswordPage() {
  const session = await getSession();
  const ready = Boolean(session) && freshRecovery(session!.amr);

  return (
    <AuthFrame
      eyebrow="New password"
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
          <FormIntro title="Choose a new password">
            For <strong className="font-semibold text-navy">{session!.email}</strong>. You&rsquo;ll stay signed in afterwards.
          </FormIntro>
          <ResetForm email={session!.email ?? ""} />
        </>
      ) : (
        <div className="grid gap-6" data-testid="reset-expired">
          <FormIntro title="That link has run out" />
          <Notice>Reset links work once, for a short time. Ask for a new one and open it straight away.</Notice>
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
