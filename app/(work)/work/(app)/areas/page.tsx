import type { Metadata } from "next";
import { Card, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { allowedAreas, slotsByDay } from "../../_lib/availability";
import { AreasForm } from "./areas-form";

export const metadata: Metadata = { title: "Areas and working days" };

export default async function AreasPage() {
  const session = await requireRole("cleaner", "/work/areas");
  const supabase = await createClient();
  const [me, pricing] = await Promise.all([
    supabase.from("cleaners").select("areas, availability").eq("id", session.userId).maybeSingle(),
    supabase.rpc("public_pricing"),
  ]);

  const header = (
    <PageHeader
      eyebrow="Areas and working days"
      title="You choose where and when."
      lede="You're self-employed: Ping never sets your hours. This just decides which jobs we offer you."
    />
  );
  if (me.error || pricing.error || !me.data) {
    return (
      <>
        {header}
        <ErrorState>Your areas didn&rsquo;t load. Check your signal and refresh.</ErrorState>
      </>
    );
  }

  const districts = allowedAreas(pricing.data?.[0]?.launch_districts ?? [], me.data.areas);
  const slots = Object.fromEntries(slotsByDay(me.data.availability));

  return (
    <>
      {header}
      <Card className="max-w-5xl sm:p-9 lg:p-12">
        <AreasForm districts={districts} areas={me.data.areas} slots={slots} />
      </Card>
    </>
  );
}
