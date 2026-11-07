import type { Metadata } from "next";
import { Card, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { DetailsForm } from "./details-form";

export const metadata: Metadata = { title: "Your details" };

export default async function DetailsPage() {
  const session = await requireRole("cleaner", "/work/details");
  const supabase = await createClient();
  const [profile, cleaner] = await Promise.all([
    supabase.from("profiles").select("full_name, phone").eq("id", session.userId).maybeSingle(),
    supabase.from("cleaners").select("bio").eq("id", session.userId).maybeSingle(),
  ]);

  return (
    <>
      <PageHeader eyebrow="Your details" title="How the Ping team reaches you." />
      {profile.error || cleaner.error || !profile.data ? (
        <ErrorState>Your details didn&rsquo;t load. Check your signal and refresh.</ErrorState>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:gap-12">
          <Card className="sm:p-9">
            <DetailsForm
              initial={{ fullName: profile.data.full_name ?? "", phone: profile.data.phone ?? "", bio: cleaner.data?.bio ?? "" }}
            />
          </Card>
          <aside className="grid content-start gap-3 rounded-lg bg-mist/60 p-7 ring-1 ring-inset ring-line sm:p-9">
            <h2 className="text-xl font-semibold">Your number stays with us</h2>
            <p className="text-ink-2">
              Customers message you through Ping, so they never see your phone number and you never see theirs.
            </p>
          </aside>
        </div>
      )}
    </>
  );
}
