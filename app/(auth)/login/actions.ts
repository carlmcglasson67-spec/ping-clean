"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { postLoginPath } from "@/lib/auth/roles";
import { createClient } from "@/lib/db/server";
import { hasSupabaseEnv } from "@/lib/env";

export type LoginState = {
  error?: string;
  fieldErrors?: { email?: string; password?: string };
  email?: string;
};

const schema = z.object({
  email: z.email({ message: "Enter the email address you use for Ping." }).max(254),
  password: z.string().min(1, { message: "Enter your password." }).max(200),
  next: z.string().max(500).optional(),
});

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
    next: formData.get("next") ? String(formData.get("next")) : undefined,
  });
  const email = String(formData.get("email") ?? "").trim();

  if (!parsed.success) {
    const fe = z.flattenError(parsed.error).fieldErrors;
    return { email, fieldErrors: { email: fe.email?.[0], password: fe.password?.[0] } };
  }
  if (!hasSupabaseEnv()) {
    return { email, error: "Sign-in isn't switched on yet. The Ping team is setting it up." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    // Same message whether the email exists or not, so the form can't be used to find accounts.
    const tooMany = error?.status === 429;
    // Supabase only says "not confirmed" once the password is right, so this reveals
    // nothing to someone guessing.
    if (error?.code === "email_not_confirmed") {
      return { email, error: "Nearly there: open the link we emailed you to finish setting up your account, then sign in." };
    }
    return {
      email,
      error: tooMany
        ? "Too many attempts. Wait a minute, then try again."
        : "That email and password don't match. Check for typos and try again.",
    };
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (!profile) {
    await supabase.auth.signOut();
    return { email, error: "Your account isn't fully set up yet. Call the Ping office and we'll sort it." };
  }

  redirect(postLoginPath(profile.role, parsed.data.next));
}
