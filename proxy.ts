import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { signedOutEntry } from "@/lib/auth/next";
import { areaForPath } from "@/lib/auth/roles";
import { resolveSiteUrl } from "@/lib/env";

/**
 * Runs before every page:
 *  1. Refreshes the Supabase session and writes new cookies (Server Components can't).
 *  2. Optimistic check: signed-out visitors to /account, /work or /admin go to /login
 *     (or /signup for booking and applying: lib/auth/next.ts signedOutEntry).
 * Role checks happen in each app's layout (lib/auth/session.ts), and RLS protects the
 * data regardless. This file never queries tables.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const area = areaForPath(request.nextUrl.pathname);
  if (!url || !key) {
    // No Supabase project yet: the public site still works, the apps show sign-in.
    return area ? NextResponse.redirect(new URL("/login", request.url)) : NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [h, v] of Object.entries(headers ?? {})) response.headers.set(h, v);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (area && !signedIn) {
    // Sign-up for the pages new people arrive at (booking, applying), sign-in for the rest.
    // On the configured site, not the host the request reports (they can differ behind a proxy).
    const entry = new URL(signedOutEntry(request.nextUrl.pathname), resolveSiteUrl() ?? request.url);
    entry.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    const redirect = NextResponse.redirect(entry);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }

  if (area) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|images/|manifest.webmanifest|robots.txt|sitemap.xml).*)"],
};
