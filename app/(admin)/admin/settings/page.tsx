import type { Metadata } from "next";
import { ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatStamp } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { toValues } from "./_lib/settings-form";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireRole("admin", "/admin/settings");
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("*").maybeSingle();

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="The numbers Ping runs on."
        lede="Nothing here is filled in for you: an empty box means it hasn't been decided. Every change is checked, shown to you before it's saved, and logged."
      />
      {error || !data ? (
        <ErrorState title="Settings didn't load">Refresh the page. Nothing has been changed.</ErrorState>
      ) : (
        <SettingsForm current={data} initial={toValues(data)} lastChanged={formatStamp(data.updated_at)} />
      )}
    </>
  );
}
