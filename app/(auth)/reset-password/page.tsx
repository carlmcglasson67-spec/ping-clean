import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { cookies } from "next/headers";
import { canChooseNewPassword, RESET_COOKIE, resetPassSecret } from "@/lib/auth/recovery";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { AuthFrame, FormIntro, Notice } from "../_components/auth-frame";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false },
};

/**
 * Reached only from an email link: the session a reset, sign-up or invite link created,
 * within 15 minutes (lib/auth/recovery.ts).
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string; invited?: string }> }) {
  const [session, jar, { next, invited: invitedParam }] = await Promise.all([getSession(), cookies(), searchParams]);
  // A brand-new account choosing its first password: decided by the account itself, as the
  // action decides it, so the page always shows the fields the action will ask for. (The
  // ?first=1 the confirm step adds is only there to carry ?next.)
  let isNew = false;
  if (session) {
    const { data } = await (await createClient()).auth.getUser();
    isNew = data.user?.user_metadata?.password_pending === true;
  }
  const ready = canChooseNewPassword(jar.get(RESET_COOKIE)?.value, session, resetPassSecret());
  // An invite (issue #21, note 3): ?invited=1 only changes the words. Invited accounts have
  // no password_pending, so the page and the action both take the normal path: password only.
  const invited = !isNew && invitedParam === "1";

  return (
    <AuthFrame
      eyebrow={isNew ? "Your password" : invited ? "Welcome to Ping" : "New password"}
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
          <FormIntro title={isNew || invited ? "Choose your password" : "Choose a new password"}>
            For <strong className="font-semibold text-navy">{session!.email}</strong>.{" "}
            {invited ? "It\u2019s what you\u2019ll sign in with from now on. You\u2019ll stay signed in afterwards." : "You\u2019ll stay signed in afterwards."}
          </FormIntro>
          <ResetForm email={session!.email ?? ""} isNew={isNew} invited={invited} next={isNew ? next : undefined} name={isNew ? (session!.fullName ?? "") : undefined} />
        </>
      ) : (
        <div className="grid gap-6" data-testid="reset-expired">
          <FormIntro title="That link has run out" />
          <Notice>
            {isNew
              ? "Your account is set up, but there's a short time limit for choosing the password. Ask for a link to choose it now."
              : invited
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
