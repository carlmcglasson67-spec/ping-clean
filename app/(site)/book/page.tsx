import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink, LogoMark } from "@/components/ui";
import { homeFor } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { Crumbs } from "../_components/blocks";
import { parsePostcode } from "../_lib/postcode";

export const metadata: Metadata = { title: "Book a clean", robots: { index: false } };

/**
 * The public way into checkout. Signed-in customers go straight to /account/book; everyone
 * else is asked to create an account (or sign in) and comes back to checkout afterwards,
 * with their postcode and hours kept. Only a clean postcode and a whole number of minutes
 * are passed on; nothing else from the URL is trusted.
 */
export default async function BookGate({ searchParams }: { searchParams: Promise<{ postcode?: string; minutes?: string }> }) {
  const q = await searchParams;
  const parsed = parsePostcode(q.postcode ?? "");
  const params = new URLSearchParams();
  if (parsed.kind === "full") params.set("postcode", parsed.postcode);
  if (q.minutes && /^\d{2,3}$/.test(q.minutes)) params.set("minutes", q.minutes);
  const next = `/account/book${params.size ? `?${params}` : ""}`;

  const session = await getSession();
  if (session) redirect((session.role === "customer" ? next : homeFor(session.role)) as Route);

  const encoded = encodeURIComponent(next);
  return (
    <section className="px-5 pb-20 pt-4 sm:px-10 lg:px-16 lg:pb-28 lg:pt-8">
      <div className="mx-auto max-w-[96rem]">
        <Crumbs items={[{ href: "/", label: "Home" }, { href: "/price", label: "Get your price" }, { label: "Book" }]} />
        <div className="signal-waves relative mt-8 grid gap-12 overflow-hidden rounded-xl p-8 pb-24 text-on-navy sm:p-12 sm:pb-28 lg:grid-cols-12 lg:p-16 lg:pb-32">
          <div className="lg:col-span-7">
            <LogoMark className="size-12" />
            <h1 className="mt-8 text-3xl font-semibold">
              One quick step: <span className="text-brand-gradient-navy">your account.</span>
            </h1>
            <p className="mt-6 max-w-xl text-xl text-on-navy-2">
              Your account is where you see who&rsquo;s coming, your dates and every receipt. Create one and we&rsquo;ll take you straight back to your booking{parsed.kind === "full" ? ` for ${parsed.postcode}` : ""}.
            </p>
          </div>
          <div className="grid content-end gap-5 lg:col-span-4 lg:col-start-9">
            {/* /signup arrives with #19. */}
            <ButtonLink href={`/signup?next=${encoded}` as Route} size="xl" variant="signal" className="w-full">
              Create an account
            </ButtonLink>
            <p className="text-center text-lg text-on-navy-2">
              Already have an account?{" "}
              <Link href={`/login?next=${encoded}` as Route} className="font-semibold text-teal underline decoration-teal/40 underline-offset-4 hover:text-on-navy">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
