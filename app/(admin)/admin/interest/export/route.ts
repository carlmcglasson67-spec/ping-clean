import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { todayInLondon } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { readAll, ROW_CAP } from "../../_lib/read-all";
import { interestCsv } from "@/lib/interest/csv";

const DISTRICT = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;

/**
 * The contact list as a CSV, for sending the one "booking is open" message. POST only (a
 * link or prefetch can't trigger it, and the browser won't send the session cookie on a
 * cross-site POST), same-origin only, admins only. admin_export_interest leaves out anyone
 * who unsubscribed and logs who exported what, and how many, without the contacts.
 * lib/interest/csv quotes every cell and defuses spreadsheet formulas.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return noStore(new NextResponse(null, { status: 404 }));
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return noStore(new NextResponse(null, { status: 403 }));

  const form = await request.formData();
  const raw = String(form.get("district") ?? "").trim().toUpperCase();
  if (raw && !DISTRICT.test(raw)) return noStore(new NextResponse(null, { status: 400 }));

  const supabase = await createClient();
  // In keyset pages, so the CSV never stops at the 1,000-row cap; then back in the
  // function's order (district, then when they signed up).
  const { data: rows, error } = await readAll((after) => {
    const q = supabase.rpc("admin_export_interest", { p_district: raw || null }).order("id").limit(ROW_CAP);
    return after ? q.gt("id", after) : q;
  }, "id");
  const data = (rows ?? []).sort((x, y) =>
    x.postcode_district.localeCompare(y.postcode_district) || x.registered_at.localeCompare(y.registered_at) || x.id.localeCompare(y.id));
  if (error) {
    return noStore(new NextResponse(null, { status: 303, headers: { Location: `/admin/interest?export=failed${raw ? `&district=${raw}` : ""}` } }));
  }

  const name = `ping-interest-${raw || "all"}-${todayInLondon()}.csv`;
  return noStore(
    new NextResponse(interestCsv(data ?? []), {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
    }),
  );
}

function noStore(res: NextResponse) {
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
