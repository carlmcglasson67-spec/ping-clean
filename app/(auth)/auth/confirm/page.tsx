import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { AuthFrame, FormIntro, Notice } from "../../_components/auth-frame";
import { confirmLink } from "./actions";
import { ConfirmButton } from "./confirm-button";

export const metadata: Metadata = {
  title: "Confirm",
  robots: { index: false },
  referrer: "no-referrer", // the link's token never leaks to another site
};

type Params = { token_hash?: string; type?: string; code?: string; next?: string; flow?: string };

/**
 * Where every Supabase email link lands. Opening it changes nothing: the link is only used
 * when the person presses the button (see actions.ts for why).
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const reset = p.type === "recovery" || p.flow === "reset";
  const usable = Boolean((p.token_hash && p.type) || p.code);

  return (
    <AuthFrame
      eyebrow={reset ? "New password" : "Nearly there"}
      statement={
        reset ? (
          <>
            One tap,
            <br />
            <span className="text-brand-gradient-navy">then a new password.</span>
          </>
        ) : (
          <>
            One tap
            <br />
            <span className="text-brand-gradient-navy">and you&rsquo;re in.</span>
          </>
        )
      }
      lede={
        reset
          ? "Press continue to choose a new password for your Ping account."
          : "Press confirm to finish setting up your Ping account. This shows us the email address really is yours."
      }
    >
      {usable ? (
        <div className="grid gap-6">
          <FormIntro title={reset ? "Reset your password" : "Confirm your email"}>
            {reset
              ? "You asked to reset your Ping password. If that wasn't you, close this page: nothing will change."
              : "You've just created a Ping account. Confirm it's yours and we'll take you in."}
          </FormIntro>
          <form action={confirmLink} className="grid gap-4">
            {(["token_hash", "type", "code", "next", "flow"] as const).map((k) =>
              p[k] ? <input key={k} type="hidden" name={k} value={String(p[k]).slice(0, 512)} /> : null,
            )}
            <ConfirmButton label={reset ? "Continue to reset your password" : "Confirm my email"} />
          </form>
        </div>
      ) : (
        <div className="grid gap-6">
          <FormIntro title="That link isn't complete" />
          <Notice>Open the link straight from the email, or ask for a new one.</Notice>
          <div>
            <ButtonLink href="/login" size="lg" variant="secondary">
              Back to sign in
            </ButtonLink>
          </div>
        </div>
      )}
    </AuthFrame>
  );
}
