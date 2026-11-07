import { describe, expect, it } from "vitest";
import { DOCUMENT_PATH, documentPath, documentType, formatBytes } from "./documents";
import { latestByKind } from "./latest";

const me = "00000000-0000-4000-a000-000000000006";
const rnd = "3f2a6c1e-8b0d-4c7a-9e5f-2d1b0a9c8e7f";

describe("cleaner documents", () => {
  it("names every upload inside the cleaner's own folder, in the shape the database checks", () => {
    const p = documentPath(me, "insurance", "application/pdf", rnd);
    expect(p).toBe(`${me}/insurance-${rnd}.pdf`);
    expect(DOCUMENT_PATH.test(p)).toBe(true);
    expect(/^[0-9a-f-]{36}\/[^/]+$/.test(p)).toBe(true); // cleaner_documents.storage_path check
  });

  it("refuses paths that could step outside the folder or fake a kind", () => {
    for (const bad of [`${me}/../x/dbs-${rnd}.pdf`, `${me}/sub/dbs-${rnd}.pdf`, `${me}/passport-${rnd}.pdf`, `${me}/dbs-${rnd}.exe`, `dbs-${rnd}.pdf`]) {
      expect(DOCUMENT_PATH.test(bad)).toBe(false);
    }
  });

  it("takes photos and PDFs, including iPhone HEIC files with no type", () => {
    expect(documentType({ type: "image/jpeg", name: "a.jpg" })).toBe("image/jpeg");
    expect(documentType({ type: "", name: "IMG_0001.HEIC" })).toBe("image/heic");
    expect(documentType({ type: "application/octet-stream", name: "scan.pdf" })).toBe("application/pdf");
    expect(documentType({ type: "application/zip", name: "x.pdf" })).toBeNull();
    expect(documentType({ type: "", name: "notes.docx" })).toBeNull();
  });

  it("describes file sizes the way people read them", () => {
    expect(formatBytes(300)).toBe("1 KB");
    expect(formatBytes(512_000)).toBe("500 KB");
    expect(formatBytes(4_404_019)).toBe("4.2 MB");
  });

  it("shows the newest copy of each document", () => {
    const docs = [
      { kind: "dbs", created_at: "2026-11-01T10:00:00Z", status: "rejected" },
      { kind: "dbs", created_at: "2026-11-03T10:00:00Z", status: "pending" },
      { kind: "insurance", created_at: "2026-10-01T10:00:00Z", status: "verified" },
    ];
    const latest = latestByKind(docs);
    expect(latest.get("dbs")?.status).toBe("pending");
    expect(latest.get("insurance")?.status).toBe("verified");
    expect(latest.get("photo_id")).toBeUndefined();
  });
});
