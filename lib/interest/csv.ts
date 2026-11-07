// The admin "Export CSV" (Track C's console calls this with admin_export_interest's rows).
// Anyone can type into the form, so every cell is treated as hostile: a value starting
// with = + - @ (or a tab or carriage return) would run as a formula in Excel or Sheets.
// Those get a leading apostrophe, and every cell is quoted. Mobiles are written as
// 447700900321 (no plus), the shape bulk-SMS tools import, so they need no apostrophe.

export type InterestExportRow = {
  postcode: string;
  postcode_district: string;
  email: string | null;
  phone: string | null;
  registered_at: string;
  notified_at: string | null;
};

const COLUMNS = ["postcode", "postcode_district", "email", "phone", "registered_at", "notified_at"] as const;

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
  const cells = (r: InterestExportRow) => COLUMNS.map((c) => csvCell(c === "phone" ? exportPhone(r.phone) : r[c]));
  const lines = [COLUMNS.join(","), ...rows.map((r) => cells(r).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}
