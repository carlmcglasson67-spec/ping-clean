import "server-only";
import { createClient } from "@/lib/db/server";
import { hasSupabaseEnv } from "@/lib/env";
import { parsePricing, type PricingState } from "./pricing-shape";

/**
 * Reads the public price, minimum booking and launch districts for this request.
 * Runs as the visitor (anon or signed in) through public_pricing(), which exposes
 * nothing internal: no commission, no tier windows.
 */
export async function getPricing(): Promise<PricingState> {
  if (!hasSupabaseEnv()) return { status: "soon" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("public_pricing");
    if (error) {
      console.error("public_pricing failed", error.code);
      return { status: "unavailable" };
    }
    return parsePricing(data);
  } catch (e) {
    console.error("public_pricing threw", e instanceof Error ? e.name : "unknown");
    return { status: "unavailable" };
  }
}
