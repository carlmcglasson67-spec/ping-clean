import type { Metadata } from "next";
import { DraftLegalPage } from "../_components/draft-page";

export const metadata: Metadata = { title: "Privacy notice (draft)", robots: { index: false } };

// PLACEHOLDER. Carl and Kate write the real privacy notice (UK GDPR); this lists what it
// must cover. Bump PRIVACY_VERSION in app/(auth)/signup/actions.ts when it's live.
export default function PrivacyPage() {
  return (
    <DraftLegalPage
      title="Privacy notice"
      intro="The final notice is being written. Until then, this page lists what it will explain: what Ping keeps about you, why, and for how long."
      sections={[
        { heading: "Who looks after your data", points: ["The company that runs Ping, and how to contact it about your data."] },
        { heading: "What we keep", points: ["Your name, email, optional phone number and your home's address and access notes.", "Your bookings, visit checklists and photos, payments and messages."] },
        { heading: "Why", points: ["To arrange and carry out your cleans, take payment and keep you informed.", "The lawful basis for each."] },
        { heading: "Who sees it", points: ["Your cleaner sees your full address only once they've taken your booking.", "Payment details stay with the payment provider; Ping never sees your card number."] },
        { heading: "How long", points: ["How long each kind of record is kept, and when it's deleted."] },
        { heading: "Your rights", points: ["Seeing, correcting or deleting what we hold.", "How to complain to the Information Commissioner's Office."] },
      ]}
    />
  );
}
