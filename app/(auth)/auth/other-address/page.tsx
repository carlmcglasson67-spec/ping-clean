import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { AuthFrame, FormIntro, Notice } from "../../_components/auth-frame";

export const metadata: Metadata = {
  title: "One more link",
  robots: { index: false },
};

/**
 * Halfway through an email change (issue #21, note 1). With Supabase's Secure email change
 * on, a link goes to the old address and one to the new; the first one used lands here.
 * Nothing about the account is shown: this page only says what to do next.
 */
export default function OtherAddressPage() {
  return (
    <AuthFrame
      eyebrow="Halfway there"
      statement={
        <>
          One down.
          <br />
          <span className="text-brand-gradient-navy">One to go.</span>
        </>
      }
      lede="To keep your account safe, a change of email address needs a yes from both addresses."
    >
      <div className="grid gap-6" data-testid="other-address">
        <FormIntro title="Now confirm the link sent to your other address">
          We&rsquo;ve sent a link to your old email address and one to your new one. That&rsquo;s the first done. Open the
          other email and press its link, and your new address is in use straight away.
        </FormIntro>
        <Notice tone="ok">Nothing changes until both links are used.</Notice>
        <p className="text-navy-2">
          Can&rsquo;t find it? Check your junk or spam folder. Links run out after a while; if it has, change your email
          address again from your account.
        </p>
        <div>
          <ButtonLink href="/login" size="lg" variant="secondary">
            Back to sign in
          </ButtonLink>
        </div>
      </div>
    </AuthFrame>
  );
}
