"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";

export type DetailsState = {
  saved?: boolean;
  error?: string;
  fieldErrors?: { fullName?: string; phone?: string; bio?: string };
  values?: { fullName: string; phone: string; bio: string };
};

// Same rules as the database (profiles.full_name, profiles.phone, cleaners.bio).
const schema = z.object({
  fullName: z.string().trim().min(2, { message: "Add your full name, as it appears on your ID." }).max(120, { message: "Keep your name under 120 characters." }),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{7,20}$/, { message: "Add a mobile number we can call or text, like 07700 900123." }),
  bio: z.string().trim().max(600, { message: "Keep it under 600 characters." }),
});

/** Name and phone (profiles) and the short intro customers see (cleaners.bio). Own rows only, by RLS. */
export async function saveDetails(_prev: DetailsState, formData: FormData): Promise<DetailsState> {
  const session = await requireRole("cleaner", "/work/details");
  const values = {
    fullName: String(formData.get("fullName") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    bio: String(formData.get("bio") ?? ""),
  };
  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    const fe = z.flattenError(parsed.error).fieldErrors;
    return { values, fieldErrors: { fullName: fe.fullName?.[0], phone: fe.phone?.[0], bio: fe.bio?.[0] } };
  }

  const supabase = await createClient();
  const [profile, cleaner] = await Promise.all([
    supabase.from("profiles").update({ full_name: parsed.data.fullName, phone: parsed.data.phone }).eq("id", session.userId).select("id"),
    supabase.from("cleaners").update({ bio: parsed.data.bio || null }).eq("id", session.userId).select("id"),
  ]);
  if (profile.error || cleaner.error || profile.data?.length !== 1 || cleaner.data?.length !== 1) {
    return { values, error: "That didn't save. Check your signal and try again." };
  }

  revalidatePath("/work", "layout");
  return { saved: true, values };
}
