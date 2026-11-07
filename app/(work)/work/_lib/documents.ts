import type { Enums } from "@/lib/db/types";

export type DocumentKind = Enums<"document_kind">;

/** Every cleaner sends all four before the Ping team can approve them. */
export const REQUIRED_DOCS: DocumentKind[] = ["dbs", "insurance", "photo_id", "right_to_work"];

/** What each document is, in the words a cleaner would use, and whether it carries an expiry date. */
export const DOC_GUIDE: Record<DocumentKind, { hint: string; expiry: "required" | "optional" | "none" }> = {
  dbs: { hint: "Your basic or enhanced DBS certificate. A photo of the paper copy is fine.", expiry: "none" },
  insurance: { hint: "Your public liability insurance certificate, showing your name and cover dates.", expiry: "required" },
  photo_id: { hint: "Passport or photo driving licence. Make sure all four corners are in the shot.", expiry: "optional" },
  right_to_work: { hint: "Passport, birth certificate with National Insurance proof, or your share code result.", expiry: "optional" },
};

/** Mirrors the cleaner-documents bucket (supabase/migrations/…_storage.sql). The bucket enforces it too. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
};
const EXT_TYPES: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heic", webp: "image/webp" };

/**
 * The file's type, from the browser or (when an iPhone leaves it blank, as it does for
 * some HEIC photos) from its extension. Null if Ping can't take it.
 */
export function documentType(file: { type: string; name: string }): string | null {
  if (file.type && DOCUMENT_TYPES[file.type]) return file.type;
  if (file.type && file.type !== "application/octet-stream") return null;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TYPES[ext] ?? null;
}

/** Storage path for a new upload: <cleaner id>/<kind>-<random>.<ext>. Never reuses a name. */
export function documentPath(cleanerId: string, kind: DocumentKind, type: string, random: string): string {
  return `${cleanerId}/${kind}-${random}.${DOCUMENT_TYPES[type]}`;
}

/** Same shape the database checks: cleaner_documents.storage_path. */
export const DOCUMENT_PATH = /^[0-9a-f-]{36}\/(dbs|insurance|photo_id|right_to_work)-[0-9a-f-]{36}\.(pdf|jpg|png|heic|webp)$/;

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
