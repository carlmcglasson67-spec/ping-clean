import type { Metadata } from "next";
import { ComingSoon } from "../_components/coming-soon";

export const metadata: Metadata = { title: "QC" };

export default function QcPage() {
  return (
    <ComingSoon
      eyebrow="Quality check"
      title="Every finished clean, scored."
      lede="Before and after photos, the checklist, and anything the cleaner couldn't do."
      meanwhile="Until this screen lands, the overview counts the finished cleans waiting for a score."
    />
  );
}
