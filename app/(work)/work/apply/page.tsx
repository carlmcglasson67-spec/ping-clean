import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ButtonLink, PageHeader } from "@/components/ui";
import { AppShell } from "@/components/ui/app-shell";
import { firstName, getSession } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/roles";
import { DOCUMENT_KIND } from "@/lib/labels";
import { REQUIRED_DOCS } from "../_lib/documents";
import { ApplyButton } from "./apply-button";

export const metadata: Metadata = { title: "Clean with Ping" };

const POINTS = [
  { n: "01", title: "Your areas, your days", body: "Pick the postcodes you'll travel to and the days you work. You only see jobs that fit." },
  { n: "02", title: "Regulars, not one-offs", body: "Claim a regular clean and the same customer stays with you, week after week." },
  { n: "03", title: "No chasing payment", body: "Customers pay through Ping after each clean, and your earnings come to you." },
];

/**
 * Where a signed-in customer starts a cleaner application. Lives outside the cleaner
 * guard (they aren't a cleaner yet). Cleaners go straight to their app; admins home.
 */
export default async function ApplyPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/work/apply");
  if (session.role === "admin") redirect(homeFor("admin"));
  if (session.role === "cleaner") {
    // Not a redirect: straight after applying, this page re-renders as a cleaner while
    // the button is moving them on, and a redirect here would race it.
    return (
      <AppShell area="/work" who={firstName(session)}>
        <PageHeader eyebrow="Clean with Ping" title="You've already applied." />
        <ButtonLink href="/work" size="lg">Go to your application</ButtonLink>
      </AppShell>
    );
  }

  return (
    <AppShell area="/work" who={firstName(session)}>
      <PageHeader
        eyebrow="Clean with Ping"
        title="Your own cleaning round. None of the admin."
        lede="Ping finds the customers, takes the bookings and handles the payments. You do the cleaning you're proud of."
      />
      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:gap-12">
        <ol className="grid content-start gap-3">
          {POINTS.map((p) => (
            <li key={p.n} className="flex gap-5 rounded-lg bg-card p-6 shadow-card ring-1 ring-line/70 sm:p-7">
              <span className="font-display text-2xl font-semibold text-teal-ink tabular">{p.n}</span>
              <div className="grid gap-1">
                <h2 className="text-xl font-semibold">{p.title}</h2>
                <p className="text-navy-2">{p.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <section className="grain relative grid content-start gap-6 overflow-hidden rounded-lg bg-navy-900 p-7 text-on-navy sm:p-9">
          <h2 className="text-xl font-semibold">What you&rsquo;ll need</h2>
          <ul className="grid gap-3">
            {REQUIRED_DOCS.map((k) => (
              <li key={k} className="flex items-center gap-3 text-on-navy-2">
                <span className="size-2 rounded-full bg-teal" aria-hidden />
                {DOCUMENT_KIND[k]}
              </li>
            ))}
          </ul>
          <p className="text-on-navy-2">
            You can photograph them on your phone as you go. Your login stays the same.
          </p>
          <ApplyButton />
        </section>
      </div>
    </AppShell>
  );
}
