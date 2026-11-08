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
export default async function ConfirmedPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [session, { next }] = await Promise.all([getSession(), searchParams]);
  if (!session) redirect("/login");
  const to = postLoginPath(session.role, safeNext(next));

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
      lede="Your Ping account is ready. Check it’s the right one, then carry on where you left off."
    >
      <div className="grid gap-6" data-testid="confirmed">
        <FormIntro title="You're signed in">
          Signed in as <strong className="font-semibold text-navy">{maskEmail(session.email)}</strong>.
        </FormIntro>
        <div>
          <ButtonLink href={to as "/account"} size="lg">
            Continue
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
