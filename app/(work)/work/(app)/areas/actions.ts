"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { allowedAreas, availabilitySchema, DISTRICT, type Slot } from "../../_lib/availability";

export type AreasState = { saved?: boolean; error?: string; fieldError?: "areas" | "days" };

/**
 * Where and when a cleaner works. Ping never sets their hours: this only decides which
 * jobs they're offered (area and day, see private.eligible_cleaners). Own row only, by
 * RLS and the column grant (areas, availability, bio).
 */
export async function saveAreas(_prev: AreasState, formData: FormData): Promise<AreasState> {
  const session = await requireRole("cleaner", "/work/areas");

  const areas = z.array(z.string().regex(DISTRICT)).max(40).safeParse(formData.getAll("areas").map(String));
  const slots: Slot[] = [];
  for (let day = 1; day <= 7; day++) {
    if (formData.get(`day-${day}`) !== "on") continue;
    slots.push({ day, from: String(formData.get(`from-${day}`) ?? ""), to: String(formData.get(`to-${day}`) ?? "") });
  }
  const availability = availabilitySchema.safeParse(slots);
  if (!areas.success) return { error: "Those areas didn't come through. Tick them again.", fieldError: "areas" };
  if (!availability.success) {
    return { error: "Check your times: each working day needs to finish after it starts.", fieldError: "days" };
  }

  const supabase = await createClient();
  const [pricing, me] = await Promise.all([
    supabase.rpc("public_pricing"),
    supabase.from("cleaners").select("areas").eq("id", session.userId).maybeSingle(),
  ]);
  if (pricing.error || me.error || !me.data) return { error: "That didn't save. Check your signal and try again." };
  // Never trust the list the browser sent: only districts Ping covers (or already yours).
  const allowed = new Set(allowedAreas(pricing.data?.[0]?.launch_districts ?? [], me.data.areas));
  if (areas.data.some((a) => !allowed.has(a))) {
    return { error: "One of those areas isn't covered by Ping yet. Untick it and save again.", fieldError: "areas" };
  }

  const { data, error } = await supabase
    .from("cleaners")
    .update({ areas: [...new Set(areas.data)], availability: availability.data })
    .eq("id", session.userId)
    .select("id");
  if (error || data?.length !== 1) return { error: "That didn't save. Check your signal and try again." };

  revalidatePath("/work", "layout");
  return { saved: true };
}
