import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";
import { pgUuid } from "../../../_lib/ids";

const TEN_MINUTES = 600; // ping-data-security rule 4

/**
 * Opens a cleaner's document for the Ping team. Signs a 10-minute URL at the moment it's
 * tapped (nothing long-lived sits in a page), as the signed-in admin: the table policy and
 * the bucket's read policy both have to agree. Never cached, never sent as a referrer.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return noStore(new NextResponse(null, { status: 404 }));

  const id = pgUuid.safeParse((await params).id);
  if (!id.success) return noStore(new NextResponse(null, { status: 404 }));

  const supabase = await createClient();
  const { data: doc } = await supabase.from("cleaner_documents").select("cleaner_id, storage_path").eq("id", id.data).maybeSingle();
  if (!doc) return noStore(new NextResponse(null, { status: 404 }));

  // Relative, so it stays on whatever host the admin is on (request.url can report another).
  const back = () => noStore(new NextResponse(null, { status: 303, headers: { Location: `/admin/approvals/${doc.cleaner_id}?view=failed` } }));
  const { data, error } = await supabase.storage.from("cleaner-documents").createSignedUrl(doc.storage_path, TEN_MINUTES);
  if (error || !data?.signedUrl) return back();
  return noStore(NextResponse.redirect(data.signedUrl, 303));
}

function noStore(res: NextResponse) {
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
