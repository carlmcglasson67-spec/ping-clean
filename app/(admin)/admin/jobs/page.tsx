import type { Metadata } from "next";
import { ComingSoon } from "../_components/coming-soon";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <ComingSoon
      eyebrow="Jobs"
      title="Every block, and what needs a hand."
      lede="Unclaimed and offered blocks, manual assignment, and the engine's alerts."
      meanwhile="Until this screen lands, the overview shows how many jobs are unclaimed and how many alerts are open."
    />
  );
}
