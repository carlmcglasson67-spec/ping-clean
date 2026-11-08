import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/next";
import { postLoginPath } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { AuthFrame, FormIntro, Notice } from "../_components/auth-frame";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; link?: string }> }) {
  const params = await searchParams;
  const next = safeNext(params.next) ?? undefined;
  if (hasSupabaseEnv()) {
    const session = await getSession();
    if (session) redirect(postLoginPath(session.role, next));
  }
  const signupHref = `/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <AuthFrame
      eyebrow="One login, three apps"
      statement={
        <>
          Same cleaner.
          <br />
          Your whole block.
          <br />
          <span className="text-brand-gradient-navy">Sorted.</span>
        </>
      }
      lede="Customers manage their cleans. Cleaners see their day. The Ping team keeps every visit on track."
    >
      <FormIntro title="Sign in to Ping">
        Customers, cleaners and the Ping team all sign in here. We&rsquo;ll take you to the right place.
      </FormIntro>
      {params.link === "expired" ? (
        <div className="mb-6">
          <Notice>That link has expired or has already been used. Sign in below, or ask for a new link.</Notice>
        </div>
      ) : null}
      <LoginForm next={next} />
      <div className="mt-10 grid gap-3 border-t border-line pt-6 text-base">
        <p className="text-navy-2">
          New to Ping?{" "}
          <Link href={signupHref as "/signup"} className="font-semibold text-blue underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
        <p className="text-navy-2">
          <Link href="/forgot-password" className="font-semibold text-blue underline-offset-4 hover:underline">
            Forgotten your password?
          </Link>
        </p>
      </div>
    </AuthFrame>
  );
}
