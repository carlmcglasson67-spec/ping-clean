import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui";
import { maskEmail } from "@/lib/auth/mask";
import { safeNext } from "@/lib/auth/next";
import { postLoginPath } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { AuthFrame, FormIntro } from "../../_components/auth-frame";

export const metadata: Metadata = {
  title: "Email confirmed",
  robots: { index: false },
};

/**
 * After an email link is confirmed: say which account is now signed in, so someone tricked
 * into confirming another person's account sees it straight away (re-review N6).
 */
export default async function ConfirmedPage({ searchParams }: { searchParams: Promise<{ next?: string; first?: string; kind?: string; invited?: string }> }) {
  const [session, { next, first, kind, invited }] = await Promise.all([getSession(), searchParams]);
  // An email change says so (issue #21, note 1); the words only, nothing else depends on it.
  const changed = kind === "email_change";
  if (!session) redirect("/login");
  const after = postLoginPath(session.role, safeNext(next));
  // A new account chooses its password next (auth/confirm/actions.ts). The page there
  // only opens with the pass the confirm step just gave this session; ?first only words it.
  const choose = first === "1";
  // ?invited=1 (set by the confirm step from the account's invited_at) only changes words.
  const welcome = choose && invited === "1";
  const to = choose ? `/reset-password?first=1&${welcome ? "invited=1&" : ""}next=${encodeURIComponent(after)}` : after;

  return (
    <AuthFrame
      eyebrow={changed ? "All changed" : welcome ? "Invitation accepted" : "You're in"}
      statement={
        changed ? (
          <>
            Email changed.
            <br />
            <span className="text-brand-gradient-navy">You&rsquo;re all set.</span>
          </>
        ) : (
          <>
            Email confirmed.
            <br />
            <span className="text-brand-gradient-navy">Welcome to Ping.</span>
          </>
        )
      }
      lede={
        changed
          ? "From now on, sign in and hear from us at your new address. Check it’s the right one below."
          : choose
            ? "One last step: choose your password. Check it’s the right account first."
            : "Your Ping account is ready. Check it’s the right one, then carry on where you left off."
      }
    >
      <div className="grid gap-6" data-testid="confirmed">
        <FormIntro title={changed ? "Your email address is changed" : "You're signed in"}>
          {changed ? "Your new address:" : "Signed in as"} <strong className="font-semibold text-navy">{maskEmail(session.email)}</strong>.
        </FormIntro>
        <div>
          <ButtonLink href={to as "/account"} size="lg">
            {choose ? "Choose my password" : "Continue"}
          </ButtonLink>
        </div>
        <form action="/logout" method="post" className="text-sm text-navy-2">
          Not you?{" "}
          <button type="submit" className="font-semibold text-blue underline-offset-4 hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </AuthFrame>
  );
}
