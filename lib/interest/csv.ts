// The admin "Export CSV" (Track C's console calls this with admin_export_interest's rows).
// Anyone can type into the form, so every cell is treated as hostile: a value starting
// with = + - @ (or a tab or carriage return) would run as a formula in Excel or Sheets.
// Those get a leading apostrophe, and every cell is quoted.
//
// Track C: show this line next to the Export button, word for word:
//   "Import directly into your SMS tool; don't re-save in Excel."
// (Re-saving in Excel can strip the quoting and turn 447… numbers into 4.47E+11.) Mobiles are written as
// 447700900321 (no plus), the shape bulk-SMS tools import, so they need no apostrophe.

export type InterestExportRow = {
  kind: "customer" | "cleaner";
  first_name: string | null;
  postcode: string;
  postcode_district: string;
  email: string | null;
  phone: string | null;
  /** The launch answers: option keys, lists of them, and the free-text "note". */
  answers: Record<string, string | string[]>;
  registered_at: string;
  notified_at: string | null;
};

const COLUMNS = ["kind", "first_name", "postcode", "postcode_district", "email", "phone", "registered_at", "notified_at", "answers"] as const;

/**
 * The answers in one cell, readable and stable: "frequency: weekly; priorities: reliable, proof; note: …".
 * Keys in alphabetical order with the note last. New lines in the note become spaces, so one
 * person is always one line of the file.
 */
export function answersCell(answers: InterestExportRow["answers"] | null | undefined): string {
  const entries = Object.entries(answers ?? {}).sort(([a], [b]) => (a === "note" ? 1 : b === "note" ? -1 : a.localeCompare(b)));
  return entries
    .map(([k, v]) => `${k}: ${(Array.isArray(v) ? v.join(", ") : String(v)).replace(/\s+/g, " ").trim()}`)
    .join("; ");
}

/** One CSV cell, safe to open in a spreadsheet. */
export function csvCell(value: string | null | undefined): string {
  let v = value ?? "";
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

/** "+447700900321" → "447700900321". */
export function exportPhone(phone: string | null): string | null {
  return phone?.replace(/^\+/, "") ?? null;
}

/** The whole file, with a header row. CRLF line endings, as spreadsheets expect. */
export function interestCsv(rows: readonly InterestExportRow[]): string {
  const cells = (r: InterestExportRow) =>
    COLUMNS.map((c) => csvCell(c === "phone" ? exportPhone(r.phone) : c === "answers" ? answersCell(r.answers) : r[c]));
  const lines = [COLUMNS.join(","), ...rows.map((r) => cells(r).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}
