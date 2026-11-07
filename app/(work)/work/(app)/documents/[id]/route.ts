import { NextResponse, type NextRequest } from "next/server";
import { pgUuid } from "../../../_lib/ids";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/db/server";

const TEN_MINUTES = 600; // ping-data-security rule 4

/**
 * Opens one of the cleaner's own documents. Signs a 10-minute URL at the moment it's
 * tapped (so nothing long-lived sits in a page), as the signed-in cleaner: the table's
 * row policy and the bucket's read policy both have to agree it's theirs.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const failed = () => noStore(NextResponse.redirect(new URL("/work/documents?view=failed", request.url), 303));
  const session = await getSession();
  if (!session || session.role !== "cleaner") return noStore(new NextResponse(null, { status: 404 }));

  const id = pgUuid.safeParse((await params).id);
  if (!id.success) return noStore(new NextResponse(null, { status: 404 }));

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("cleaner_documents")
    .select("storage_path")
    .eq("id", id.data)
    .eq("cleaner_id", session.userId)
    .maybeSingle();
  if (!doc) return failed();

  const { data, error } = await supabase.storage.from("cleaner-documents").createSignedUrl(doc.storage_path, TEN_MINUTES);
  if (error || !data?.signedUrl) return failed();
  return noStore(NextResponse.redirect(data.signedUrl, 303));
}

function noStore(res: NextResponse) {
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
