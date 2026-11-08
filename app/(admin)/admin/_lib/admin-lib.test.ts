import { describe, expect, it } from "vitest";
import { ALERT_KIND, alertKind } from "./alerts";
import { auditEntity, auditSummary } from "./audit";
import { adminErrorMessage } from "./errors";
import { missingSettings, REQUIRED_SETTINGS } from "./required-settings";

describe("admin error wording", () => {
  it("rewords codes that mean something else to the Ping team", () => {
    expect(adminErrorMessage({ code: "PC001" })).toMatch(/cleaner isn't active/);
    expect(adminErrorMessage({ code: "PC005" })).toBe("That block has already ended.");
  });
  it("falls through to the shared list, and never shows raw database text", () => {
    expect(adminErrorMessage({ code: "PC022" })).toBe("We don't clean in that area yet.");
    expect(adminErrorMessage({ code: "XX000" })).toBe("Something went wrong. Please try again.");
    expect(adminErrorMessage(null)).toBe("Something went wrong. Please try again.");
  });
  it("names the settings rule a save broke, by constraint name only", () => {
    const err = (name: string) => ({ code: "23514", message: `new row for relation "settings" violates check constraint "${name}"` });
    expect(adminErrorMessage(err("settings_late_cancel_share_follows_split"))).toMatch(/only applies with a fixed share/);
    expect(adminErrorMessage(err("settings_late_cancel_share"))).toMatch(/needs the cleaner's share/);
    expect(adminErrorMessage(err("some_other_check"))).toBe("Something went wrong. Please try again.");
  });
});

describe("alerts", () => {
  it("knows every kind the database allows", () => {
    for (const k of ["release_failed", "generate_failed", "visit_needs_cover", "visit_no_show", "visit_unfinished", "block_overlap", "block_stalled", "block_closed"]) {
      expect(alertKind(k)).toBe(k);
      expect(ALERT_KIND[alertKind(k)!].todo.length).toBeGreaterThan(20);
    }
    expect(alertKind("something_new")).toBeNull();
  });
});

describe("audit lines", () => {
  it("names the thing and the fields that moved, never values", () => {
    expect(auditEntity("cleaner_documents")).toBe("Document");
    expect(auditSummary("update", { status: { from: "pending", to: "verified" }, rejection_reason: "changed" })).toBe("changed: status, rejection reason");
    expect(auditSummary("export", { rows: 3 })).toBe("exported");
    expect(auditSummary("update", {})).toBe("changed");
  });
});

describe("required settings", () => {
  it("lists every unset number, and an empty district list as unset", () => {
    expect(missingSettings(null)).toHaveLength(REQUIRED_SETTINGS.length);
    const all = { price_per_hour_pence: 1, min_booking_minutes: 60, commission_type: "percent" as const, commission_value: 0,
      top_window_minutes: 0, approved_window_minutes: 0, unclaimed_alert_minutes: 1, dispute_window_hours: 0, launch_districts: ["CA14"] };
    expect(missingSettings(all)).toEqual([]);
    expect(missingSettings({ ...all, launch_districts: [] }).map((m) => m.key)).toEqual(["launch_districts"]);
  });
});
