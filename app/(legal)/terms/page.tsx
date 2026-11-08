import type { Metadata } from "next";
import { DraftLegalPage } from "../_components/draft-page";

export const metadata: Metadata = { title: "Terms of use (draft)", robots: { index: false } };

// PLACEHOLDER. Carl and Kate (Crystal Clear Accountancy) write the real terms; this lists
// what they need to cover. Bump TERMS_VERSION in app/(auth)/signup/actions.ts when it's live.
export default function TermsPage() {
  return (
    <DraftLegalPage
      title="Terms of use"
      intro="The final terms are being written. Until then, this page lists what they will cover, so nothing is left out."
      sections={[
        { heading: "Who Ping is", points: ["Ping Clean introduces customers to independent, self-employed cleaners in West Cumbria.", "Which company runs Ping, and how to contact it."] },
        { heading: "What you book", points: ["Regular home cleans, booked as a block of 1 to 8 cleans.", "Who the clean is bought from, and Ping's role as the introducing agent."] },
        { heading: "Paying", points: ["When your card is charged, and what for.", "Receipts, refunds and disputes."] },
        { heading: "Changes and cancelling", points: ["How much notice to give, and any late-cancellation fee.", "What happens if a cleaner can't make it."] },
        { heading: "Cleaners", points: ["Vetting before any cleaner sees a job.", "Cleaners are self-employed and choose their own work."] },
        { heading: "Your account", points: ["Keeping your login safe.", "Closing your account."] },
      ]}
    />
  );
}
