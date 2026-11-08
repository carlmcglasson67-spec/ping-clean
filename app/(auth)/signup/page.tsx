import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/next";
import { postLoginPath } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { AuthFrame, FormIntro } from "../_components/auth-frame";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create your account",
  robots: { index: false },
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next) ?? undefined;
  if (hasSupabaseEnv()) {
    const session = await getSession();
    if (session) redirect(postLoginPath(session.role, next));
  }
  const applying = next?.startsWith("/work/apply") ?? false;
  const signInHref = `/login${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <AuthFrame
      eyebrow={applying ? "Clean for Ping" : "Create your account"}
      statement={
        applying ? (
          <>
            Your areas.
            <br />
            Your hours.
            <br />
            <span className="text-brand-gradient-navy">Your regulars.</span>
          </>
        ) : (
          <>
            A cleaner home
            <br />
            is just a <span className="text-brand-gradient-navy">Ping away.</span>
          </>
        )
      }
      lede={
        applying
          ? "Start with an account. Next, you'll tell us about yourself and send your documents, and the Ping team checks everything before you see a single job."
          : "One account for booking your regular clean, seeing who's coming and when, and paying only once each clean is done."
      }
    >
      <FormIntro title={applying ? "First, create your account" : "Create your Ping account"}>
        {applying
          ? "It takes a minute. Then you'll go straight on to your cleaner application."
          : "It takes a minute. If you're part-way through booking, we'll take you straight back to it."}
      </FormIntro>
      <SignupForm next={next} signInHref={signInHref} />
    </AuthFrame>
  );
}
