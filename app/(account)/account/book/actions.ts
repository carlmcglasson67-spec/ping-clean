"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { bookSeriesArgs, bookSeriesInput } from "@/lib/booking";
import { createClient } from "@/lib/db/server";
import { isPingError, pingErrorMessage } from "@/lib/db/errors";
import { cleanFields, cleanWindow, homeChoice, homeFields } from "../../../(site)/_lib/checkout";
import { getPricing } from "../../../(site)/_lib/pricing";

export type BookState = { error?: string; fields?: Record<string, string> };

/** First message per field, keyed the way the form names its inputs. */
function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? "form");
    out[k] ??= i.message;
  }
  return out;
}

/**
 * Confirms a booking. Everything is re-checked here and again inside book_series:
 * nothing from the browser is trusted, and there's no price field to send.
 *
 * Double taps: the form makes one request id per checkout. If a series with that id is
 * already ours we go straight to it, and book_series itself replays the same id.
 */
export async function confirmBooking(_prev: BookState, form: FormData): Promise<BookState> {
  const session = await requireRole("customer", "/account/book");
  const supabase = await createClient();
  const raw = Object.fromEntries(form.entries());

  const choice = homeChoice.safeParse(raw.home);
  const clean = cleanFields.safeParse(raw);
  if (!choice.success || !clean.success) {
    return { error: "Check the highlighted details.", fields: fieldErrors([...(choice.success ? [] : [{ path: ["home"], message: "Choose a home" }]), ...(clean.success ? [] : clean.error.issues)]) };
  }
  const c = clean.data;

  // Already booked with this id (a retry after a slow network): show it, book nothing.
  const replay = await supabase.from("series").select("id").eq("client_request_id", c.requestId).maybeSingle();
  if (replay.error) return { error: pingErrorMessage(replay.error) };
  if (replay.data) redirect(`/account/booking/${replay.data.id}` as Route);

  // Refuse what book_series would refuse before writing a home, so a refusal never
  // leaves a stray address on the account.
  const pricing = await getPricing();
  if (pricing.status !== "open") return { error: pingErrorMessage({ code: "PC020" }) };
  if (c.durationMinutes < pricing.minBookingMinutes) return { error: pingErrorMessage({ code: "PC023" }), fields: { durationMinutes: "Too short" } };
  const slot = cleanWindow(c.arrival, c.durationMinutes);
  if (!slot) return { error: "That clean would run past 8pm. Pick an earlier arrival or fewer hours.", fields: { arrival: "Too late for this many hours" } };

  let propertyId: string;
  if (choice.data === "new") {
    const home = homeFields.safeParse(raw);
    if (!home.success) return { error: "Check the highlighted details.", fields: fieldErrors(home.error.issues) };
    const h = home.data;
    const district = h.postcode.split(" ")[0]!;
    if (!pricing.launchDistricts.includes(district)) return { error: pingErrorMessage({ code: "PC022" }), fields: { postcode: "Not covered yet" } };

    // The same address typed again (a retry, or a second booking) reuses the home rather
    // than making a copy. RLS limits this to the customer's own homes.
    const existing = await supabase
      .from("properties")
      .select("id, address_line1")
      .eq("postcode", h.postcode);
    if (existing.error) return { error: pingErrorMessage(existing.error) };
    const same = existing.data.find((p) => p.address_line1.trim().toLowerCase() === h.addressLine1.toLowerCase());
    if (same) {
      propertyId = same.id;
    } else {
      const inserted = await supabase
        .from("properties")
        .insert({
          customer_id: session.userId,
          address_line1: h.addressLine1,
          address_line2: h.addressLine2,
          town: h.town,
          postcode: h.postcode,
          bedrooms: h.bedrooms,
          bathrooms: h.bathrooms,
          pets: h.pets,
          access_notes: h.accessNotes,
          key_code: h.keyCode,
        })
        .select("id")
        .single();
      if (inserted.error) {
        console.error("checkout: property insert failed", inserted.error.code);
        return { error: pingErrorMessage(inserted.error) };
      }
      propertyId = inserted.data.id;
    }
  } else {
    propertyId = choice.data; // book_series checks it's ours (PC021) and in the area (PC022)
  }

  const input = bookSeriesInput.safeParse({
    propertyId,
    frequency: c.frequency,
    preferredDay: c.preferredDay,
    windowStart: slot.start,
    windowEnd: slot.end,
    durationMinutes: c.durationMinutes,
    startsOn: c.startsOn,
    blockSize: c.blockSize,
    requestId: c.requestId,
  });
  if (!input.success) return { error: "Check the highlighted details.", fields: fieldErrors(input.error.issues) };

  const booked = await supabase.rpc("book_series", bookSeriesArgs(input.data));
  if (booked.error || !booked.data) {
    if (!isPingError(booked.error)) console.error("checkout: book_series failed", booked.error?.code);
    return { error: pingErrorMessage(booked.error) };
  }

  // A-4 (Stripe): once card saving exists, create the SetupIntent for this series here
  // and send the customer to the card step before the confirmation.
  redirect(`/account/booking/${booked.data}` as Route);
}
