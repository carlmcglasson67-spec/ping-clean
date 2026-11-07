// The admin "Export CSV" (Track C's console calls this with admin_export_interest's rows).
// Anyone can type into the form, so every cell is treated as hostile: a value starting
// with = + - @ (or a tab or carriage return) would run as a formula in Excel or Sheets.
// Those get a leading apostrophe, and every cell is quoted.

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

/** The whole file, with a header row. CRLF line endings, as spreadsheets expect. */
export function interestCsv(rows: readonly InterestExportRow[]): string {
  const lines = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}
