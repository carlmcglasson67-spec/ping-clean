import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/db/server";
import { hasSupabaseEnv } from "@/lib/env";

// POST only, so a link or an image tag on another site can't sign someone out.
export async function POST(request: NextRequest) {
  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
