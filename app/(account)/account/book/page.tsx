import type { Metadata } from "next";
import { ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { todayInLondon } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { InstantPrice } from "../../../(site)/_components/instant-price";
import { addDays } from "../../../(site)/_lib/checkout";
import { parsePostcode } from "../../../(site)/_lib/postcode";
import { interestFormSetup } from "@/lib/interest/server";
import { getPricing } from "../../../(site)/_lib/pricing";
import { clampMinutes } from "../../../(site)/_lib/quote";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = { title: "Book a clean", robots: { index: false } };

export default async function BookPage({ searchParams }: { searchParams: Promise<{ postcode?: string; minutes?: string }> }) {
  const q = await searchParams;
  const back = `/account/book${q.postcode || q.minutes ? `?${new URLSearchParams({ ...(q.postcode ? { postcode: q.postcode } : {}), ...(q.minutes ? { minutes: q.minutes } : {}) })}` : ""}`;
  await requireRole("customer", back);

  const pricing = await getPricing();
  if (pricing.status !== "open") {
    const interest = await interestFormSetup();
    return (
      <>
        <PageHeader eyebrow="Book a clean" title="Not quite yet." lede="We’ll open online booking as soon as our prices are set and our first cleaners are ready." />
        <InstantPrice pricing={pricing} interest={interest} />
      </>
    );
  }

  const supabase = await createClient();
  // RLS: only this customer's homes come back.
  const homes = await supabase.from("properties").select("id, address_line1, town, postcode, bedrooms, bathrooms").order("created_at");
  if (homes.error) {
    return (
      <>
        <PageHeader eyebrow="Book a clean" title="Book a clean" />
        <ErrorState>We couldn&rsquo;t load your details just now. Refresh the page to try again.</ErrorState>
      </>
    );
  }

  const parsed = parsePostcode(q.postcode ?? "");
  const minutes = clampMinutes(Number(q.minutes) || pricing.minBookingMinutes, pricing.minBookingMinutes);
  const tomorrow = addDays(todayInLondon(), 1);

  return (
    <>
      <PageHeader
        eyebrow="Book a clean"
        title="Your clean, your way."
        lede="Five quick steps. No contract: book up to 8 cleans, and rebook any time."
      />
      <CheckoutForm
        pricing={pricing}
        homes={homes.data}
        initialPostcode={parsed.kind === "full" ? parsed.postcode : ""}
        initialMinutes={minutes}
        earliestStart={tomorrow}
      />
    </>
  );
}
