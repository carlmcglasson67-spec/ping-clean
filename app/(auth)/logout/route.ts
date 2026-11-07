import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/auth/links";
import { RESET_COOKIE, RESET_COOKIE_OPTIONS } from "@/lib/auth/reset-pass";
import { createClient } from "@/lib/db/server";
import { hasSupabaseEnv } from "@/lib/env";

// POST only, so a link or an image tag on another site can't sign someone out.
export async function POST(request: NextRequest) {
  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  const res = NextResponse.redirect(siteUrl("/login", request), { status: 303 });
  res.cookies.delete({ name: RESET_COOKIE, path: RESET_COOKIE_OPTIONS.path }); // a reset pass never outlives the session
  return res;
}
