import { z } from "zod";

/**
 * What the public site knows about pricing, from public.public_pricing().
 * "open" only when every setting booking depends on is filled in; otherwise the site
 * shows "booking opens soon" and never a made-up number.
 */
export type PricingState =
  | { status: "open"; pricePerHourPence: number; minBookingMinutes: number; launchDistricts: string[] }
  | { status: "soon" }
  | { status: "unavailable" };

const row = z.object({
  price_per_hour_pence: z.number().int().positive().nullable(),
  min_booking_minutes: z.number().int().positive().multipleOf(30).nullable(),
  launch_districts: z.array(z.string().regex(/^[A-Z]{1,2}[0-9][A-Z0-9]?$/)),
  ready: z.boolean(),
});

export function parsePricing(data: unknown): PricingState {
  const parsed = z.array(row).length(1).safeParse(data);
  if (!parsed.success) return { status: "unavailable" };
  const [r] = parsed.data as [z.infer<typeof row>];
  if (!r.ready || r.price_per_hour_pence === null || r.min_booking_minutes === null || r.launch_districts.length === 0) {
    return { status: "soon" };
  }
  return {
    status: "open",
    pricePerHourPence: r.price_per_hour_pence,
    minBookingMinutes: r.min_booking_minutes,
    launchDistricts: r.launch_districts,
  };
}
