import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PingMark, Wordmark } from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { postLoginPath } from "@/lib/auth/roles";
import { hasSupabaseEnv } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (hasSupabaseEnv()) {
    const session = await getSession();
    if (session) redirect(postLoginPath(session.role, next));
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      {/* Statement panel: ink, grain, the signal ring. Hidden on small phones to keep sign-in one screen. */}
      <section className="grain relative hidden overflow-hidden bg-ink p-12 text-paper lg:flex lg:flex-col xl:p-16">
        <Wordmark tone="paper" />
        <div className="relative mt-auto max-w-[36rem] pt-24">
          <p className="mb-6 text-sm font-semibold uppercase tracking-[0.16em] text-signal">One login, three apps</p>
          <h1 className="text-[clamp(3rem,1rem+4.2vw,6rem)] font-semibold leading-[0.95]">
            Same cleaner.
            <br />
            Every week.
            <br />
            <span className="text-signal">Sorted.</span>
          </h1>
          <p className="mt-8 max-w-md text-lg text-paper/70">
            Customers manage their cleans. Cleaners see their day. The Ping team keeps every visit on track.
          </p>
        </div>
        <svg aria-hidden viewBox="0 0 600 600" className="pointer-events-none absolute -right-40 -top-40 size-[44rem] text-paper/[0.07]">
          {[80, 150, 220, 290].map((r) => (
            <circle key={r} cx="300" cy="300" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
          ))}
          <circle cx="300" cy="300" r="22" className="fill-signal" fillOpacity="0.9" />
        </svg>
      </section>

      <section className="flex flex-col px-6 pb-10 pt-8 sm:px-12 lg:px-16 xl:px-24">
        <div className="lg:hidden">
          <Wordmark />
        </div>
        <div className="my-auto w-full max-w-[28rem] py-12">
          <div className="mb-10 grid gap-4">
            <PingMark pulse className="text-ink" />
            <h2 className="text-2xl font-semibold">Sign in to Ping</h2>
            <p className="text-ink-2">Customers, cleaners and the Ping team all sign in here. We&rsquo;ll take you to the right place.</p>
          </div>
          <LoginForm next={next} />
          <p className="mt-10 border-t border-line pt-6 text-sm text-ink-3">
            Forgotten your password, or need an account? Call the Ping office and we&rsquo;ll get you in.
          </p>
        </div>
      </section>
    </div>
  );
}
