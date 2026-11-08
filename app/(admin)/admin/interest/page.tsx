import type { Metadata } from "next";
import { ComingSoon } from "../_components/coming-soon";

export const metadata: Metadata = { title: "Interest" };

export default function InterestPage() {
  return (
    <ComingSoon
      eyebrow="Register interest"
      title="Where people want Ping next."
      lede="Sign-ups by postcode district, the one message when booking opens, and deletion on request."
      meanwhile="Until this screen lands, the list is kept safely and nobody can read it, admins included."
    />
  );
}
