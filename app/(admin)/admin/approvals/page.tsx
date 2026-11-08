import type { Metadata } from "next";
import { ComingSoon } from "../_components/coming-soon";

export const metadata: Metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return (
    <ComingSoon
      eyebrow="Approvals"
      title="Vetting new cleaners."
      lede="Applicants, their four documents, and the decision to let them work."
      meanwhile="Until this screen lands, the overview still counts who is waiting and how many documents need checking."
    />
  );
}
