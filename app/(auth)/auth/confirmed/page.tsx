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
export default async function ConfirmedPage({ searchParams }: { searchParams: Promise<{ next?: string; first?: string }> }) {
  const [session, { next, first }] = await Promise.all([getSession(), searchParams]);
  if (!session) redirect("/login");
  const after = postLoginPath(session.role, safeNext(next));
  // A new account chooses its password next (auth/confirm/actions.ts). The page there
  // only opens with the pass the confirm step just gave this session; ?first only words it.
  const choose = first === "1";
  const to = choose ? `/reset-password?first=1&next=${encodeURIComponent(after)}` : after;

  return (
    <AuthFrame
      eyebrow="You're in"
      statement={
        <>
          Email confirmed.
          <br />
          <span className="text-brand-gradient-navy">Welcome to Ping.</span>
        </>
      }
      lede={choose ? "One last step: choose your password. Check it’s the right account first." : "Your Ping account is ready. Check it’s the right one, then carry on where you left off."}
    >
      <div className="grid gap-6" data-testid="confirmed">
        <FormIntro title="You're signed in">
          Signed in as <strong className="font-semibold text-navy">{maskEmail(session.email)}</strong>.
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
