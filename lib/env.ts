import { z } from "zod";

// Public values only. Safe to import anywhere, including the browser.
// Server-only secrets are read in lib/db/admin.ts, never here.
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

let cached: z.infer<typeof schema> | undefined;

export function publicEnv() {
  if (cached) return cached;
  const parsed = schema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Ping is missing configuration: ${missing}. Copy .env.example to .env.local.`);
  }
  cached = parsed.data;
  return cached;
}

/** True when Supabase keys are present. Lets the public site render before the project exists. */
export function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Ping's own address, for email links and redirects (server side). Never a silent
 * localhost in production: an email link pointing at the wrong site is a broken, or
 * worse, an unsafe sign-up and reset flow.
 *   1. NEXT_PUBLIC_SITE_URL when set (in Vercel, set it for Production only).
 *   2. On a Vercel preview deployment, that deployment's own address (VERCEL_URL).
 *   3. In development and tests, http://localhost:3000.
 * Otherwise in production: null.
 */
export function resolveSiteUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return z.url().safeParse(explicit).success ? new URL(explicit).origin : null;
  if (env.VERCEL_ENV === "preview" && env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (env.NODE_ENV !== "production") return "http://localhost:3000";
  return null;
}

/** The site address, or a clear error. For anything that builds a link people will follow. */
export function requireSiteUrl(): string {
  const url = resolveSiteUrl();
  if (!url) throw new Error("Ping is missing configuration: NEXT_PUBLIC_SITE_URL (required in production).");
  return url;
}
