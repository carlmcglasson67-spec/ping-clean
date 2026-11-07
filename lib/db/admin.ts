import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "./types";

/**
 * Service-role client: bypasses row level security entirely.
 *
 * Server only (the "server-only" import makes a client bundle fail to build), and
 * blocked from app/ and components/ by ESLint and scripts/check-secrets.sh.
 * Use it only for work no user is allowed to do directly: writing payments from
 * Stripe webhooks, background jobs. Every caller must authorise the request itself
 * first and validate input with zod. See .claude/skills/ping-data-security.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (server environment only).");
  return createSupabaseClient<Database>(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
