import type { Metadata, Route } from "next";
import Link from "next/link";
import { Badge, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { TIER } from "@/lib/labels";
import { weekdayName } from "@/lib/dates";
import { slotsByDay } from "../../_lib/availability";
import { REQUIRED_DOCS } from "../../_lib/documents";
import { latestByKind } from "../../_lib/latest";

export const metadata: Metadata = { title: "You" };

function areasNote(areas: string[], availability: unknown): string {
  if (areas.length === 0) return "Choose the postcodes you'll travel to";
  const days = [...slotsByDay(availability).keys()].sort().map((d) => weekdayName(d).slice(0, 3));
  return `${areas.join(", ")} · ${days.length ? days.join(", ") : "any day"}`;
}

export default async function YouPage() {
  const session = await requireRole("cleaner", "/work/you");
  const supabase = await createClient();
  const [cleaner, profile, docs] = await Promise.all([
    supabase.from("cleaners").select("status, tier, areas, availability").eq("id", session.userId).maybeSingle(),
    supabase.from("profiles").select("full_name, phone").eq("id", session.userId).maybeSingle(),
    supabase.from("cleaner_documents").select("kind, status, created_at").eq("cleaner_id", session.userId),
  ]);
  if (cleaner.error || profile.error || docs.error) {
    return <ErrorState>Your account didn&rsquo;t load. Check your signal and refresh.</ErrorState>;
  }

  const latest = latestByKind(docs.data ?? []);
  const verified = REQUIRED_DOCS.filter((k) => latest.get(k)?.status === "verified").length;
  const needsAction = REQUIRED_DOCS.some((k) => !latest.get(k) || ["rejected", "expired"].includes(latest.get(k)!.status));
  const detailsDone = Boolean(profile.data?.full_name && profile.data?.phone);

  const rows: { href: Route; title: string; note: string; badge?: { tone: "ok" | "warn" | "bad" | "neutral"; label: string } }[] = [
    {
      href: "/work/details",
      title: "Your details",
      note: detailsDone ? `${profile.data!.full_name} · ${profile.data!.phone}` : "Name and mobile number",
      badge: detailsDone ? undefined : { tone: "warn", label: "To do" },
    },
    {
      href: "/work/documents",
      title: "Documents",
      note: `${verified} of ${REQUIRED_DOCS.length} verified`,
      badge: needsAction ? { tone: "bad", label: "Action needed" } : verified === REQUIRED_DOCS.length ? { tone: "ok", label: "All verified" } : undefined,
    },
    {
      href: "/work/areas",
      title: "Areas and working days",
      note: areasNote(cleaner.data?.areas ?? [], cleaner.data?.availability),
      badge: cleaner.data?.areas.length ? undefined : { tone: "warn", label: "To do" },
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={cleaner.data?.status === "active" ? `${TIER[cleaner.data.tier]} cleaner` : "Your application"}
        title="Your account."
      />
      <ul className="grid max-w-3xl gap-3">
        {rows.map((r) => (
          <li key={r.href}>
            <Link
              href={r.href}
              className="group flex min-h-20 items-center gap-5 rounded-lg bg-card p-5 shadow-card ring-1 ring-line/70 transition-shadow hover:shadow-lift sm:p-6"
            >
              <div className="grid flex-1 gap-1">
                <span className="text-lg font-semibold">{r.title}</span>
                <span className="text-sm text-navy-2">{r.note}</span>
              </div>
              {r.badge ? <Badge tone={r.badge.tone}>{r.badge.label}</Badge> : null}
              <svg viewBox="0 0 24 24" className="size-6 text-navy-3 transition-transform group-hover:translate-x-0.5" aria-hidden>
                <path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
