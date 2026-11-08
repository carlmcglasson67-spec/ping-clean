import type { Metadata } from "next";
import { ComingSoon } from "../_components/coming-soon";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <ComingSoon
      eyebrow="Settings"
      title="The numbers Ping runs on."
      lede="Price, commission, minimum booking, offer windows and cancellation rules."
      meanwhile="Until this screen lands, the overview lists any number still to be decided. Booking stays off until every one is set."
    />
  );
}
