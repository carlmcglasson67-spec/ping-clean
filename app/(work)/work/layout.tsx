import type { Metadata } from "next";
import type { ReactNode } from "react";

// The cleaner app. Two parts:
//   (app)/  everything a cleaner or applicant uses: guarded by role in its own layout
//   apply/  where a signed-in customer becomes an applicant (they aren't a cleaner yet,
//           so it can't sit behind the cleaner guard)
export const metadata: Metadata = { title: "Cleaner", robots: { index: false } };

export default function WorkRoot({ children }: { children: ReactNode }) {
  return children;
}
