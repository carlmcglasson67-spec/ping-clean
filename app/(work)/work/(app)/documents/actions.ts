"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { todayInLondon } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import { DOC_GUIDE, DOCUMENT_PATH, REQUIRED_DOCS } from "../../_lib/documents";

export type RecordResult = { ok: true } | { ok: false; error: string };

const input = z.object({
  kind: z.enum(REQUIRED_DOCS as [string, ...string[]]),
  path: z.string().regex(DOCUMENT_PATH),
  expiresOn: z.iso.date().nullable(),
});

/**
 * Records a document the cleaner has just uploaded straight to the private bucket.
 * The file never passes through this server (phone photos are bigger than a Server
 * Action will take); the bucket's own policy only lets a cleaner write into their own
 * folder, and this checks the path is theirs before the row is written. The row starts
 * as "pending": only an admin can verify it.
 */
export async function recordDocument(raw: unknown): Promise<RecordResult> {
  const session = await requireRole("cleaner", "/work/documents");
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That file didn't come through properly. Choose it again." };
  const { kind, path, expiresOn } = parsed.data;

  if (!path.startsWith(`${session.userId}/`)) {
    return { ok: false, error: "That file didn't come through properly. Choose it again." };
  }
  const rule = DOC_GUIDE[kind as keyof typeof DOC_GUIDE].expiry;
  if (rule === "required" && !expiresOn) return { ok: false, error: "Add the date your cover ends." };
  if (rule === "none" && expiresOn) return { ok: false, error: "That file didn't come through properly. Choose it again." };
  if (expiresOn && expiresOn <= todayInLondon()) {
    return { ok: false, error: "That date has already passed. Send a document that's still in date." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("cleaner_documents").insert({
    cleaner_id: session.userId,
    kind: kind as (typeof REQUIRED_DOCS)[number],
    storage_path: path,
    expires_on: expiresOn,
  });
  if (error) {
    // RLS refuses a cleaner who has left or been suspended; anything else is the network.
    return {
      ok: false,
      error: error.code === "42501"
        ? "Your account can't take new documents just now. Call the Ping office."
        : "We got the file but couldn't save it. Check your signal and press Try again.",
    };
  }

  revalidatePath("/work");
  revalidatePath("/work/documents");
  return { ok: true };
}
