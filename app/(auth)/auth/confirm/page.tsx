import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { AuthFrame, FormIntro, Notice } from "../../_components/auth-frame";
import { confirmLink } from "./actions";
import { ConfirmButton } from "./confirm-button";
import { linkWording } from "./wording";

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
  const w = linkWording(p);
  const usable = Boolean((p.token_hash && p.type) || p.code);

  return (
    <AuthFrame
      eyebrow={w.eyebrow}
      statement={
        <>
          {w.statement[0]}
          <br />
          <span className="text-brand-gradient-navy">{w.statement[1]}</span>
        </>
      }
      lede={w.lede}
    >
      {usable ? (
        <div className="grid gap-6">
          <FormIntro title={w.title}>{w.intro}</FormIntro>
          <form action={confirmLink} className="grid gap-4">
            {(["token_hash", "type", "code", "next", "flow"] as const).map((k) =>
              p[k] ? <input key={k} type="hidden" name={k} value={String(p[k]).slice(0, 512)} /> : null,
            )}
            <ConfirmButton label={w.button} />
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
