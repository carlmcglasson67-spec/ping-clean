import { describe, expect, it } from "vitest";
import { bpsToText, changes, parseSettings, penceToText, toValues, unsetRequired, type SettingsRow, type Values } from "./settings-form";

const empty: SettingsRow = {
  id: true, price_per_hour_pence: null, min_booking_minutes: null, commission_type: null, commission_value: null,
  top_window_minutes: null, approved_window_minutes: null, unclaimed_alert_minutes: null, cancel_notice_hours: null,
  late_cancel_fee_pence: null, late_cancel_cleaner_share_bps: null, dispute_window_hours: null, launch_districts: [],
  updated_at: "2026-11-08T10:00:00+00:00", rebook_first_refusal_minutes: null, interest_retention_months: 6,
};

const full: Values = {
  price_per_hour_pence: "22.50", min_booking_minutes: "2.5", commission_type: "percent", commission_value: "12.5",
  top_window_minutes: "120", approved_window_minutes: "240", unclaimed_alert_minutes: "720", cancel_notice_hours: "24",
  late_cancel_fee_pence: "15", late_cancel_cleaner_share_bps: "50", dispute_window_hours: "48",
  launch_districts: "ca14, CA28 ca14", rebook_first_refusal_minutes: "", interest_retention_months: "6",
};

describe("settings form: parsing", () => {
  it("turns typed text into whole pence, minutes and basis points with no floats", () => {
    const r = parseSettings(full);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      price_per_hour_pence: 2250, min_booking_minutes: 150, commission_value: 1250, late_cancel_fee_pence: 1500,
      late_cancel_cleaner_share_bps: 5000, launch_districts: ["CA14", "CA28"], rebook_first_refusal_minutes: null,
    });
    expect(parseSettings({ ...full, price_per_hour_pence: "£19.99" })).toMatchObject({ ok: true, data: { price_per_hour_pence: 1999 } });
    expect(parseSettings({ ...full, price_per_hour_pence: "0.1" })).toMatchObject({ ok: true, data: { price_per_hour_pence: 10 } });
  });

  it("empty means unset, never a default", () => {
    const r = parseSettings({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.price_per_hour_pence).toBeNull();
      expect(r.data.launch_districts).toEqual([]);
      expect(unsetRequired(r.data).length).toBe(9);
    }
  });

  it("refuses anything that isn't a clean value, with words to fix it", () => {
    const bad = (v: Values) => (parseSettings({ ...full, ...v }) as { ok: false; errors: Record<string, string> }).errors;
    expect(bad({ price_per_hour_pence: "22.505" }).price_per_hour_pence).toMatch(/pounds and pence/);
    expect(bad({ price_per_hour_pence: "-5" }).price_per_hour_pence).toBeDefined();
    expect(bad({ price_per_hour_pence: "0" }).price_per_hour_pence).toMatch(/more than £0/);
    expect(bad({ min_booking_minutes: "2.25" }).min_booking_minutes).toBeDefined();
    expect(bad({ min_booking_minutes: "0.5" }).min_booking_minutes).toBeDefined();
    expect(bad({ commission_value: "100" }).commission_value).toMatch(/earn nothing/);
    expect(bad({ commission_value: "101" }).commission_value).toBeDefined();
    expect(bad({ top_window_minutes: "1.5" }).top_window_minutes).toBeDefined();
    expect(bad({ unclaimed_alert_minutes: "0" }).unclaimed_alert_minutes).toBeDefined();
    expect(bad({ launch_districts: "CA14, NOPE" }).launch_districts).toMatch(/NOPE/);
    expect(bad({ interest_retention_months: "25" }).interest_retention_months).toBeDefined();
    expect(bad({ commission_type: "", commission_value: "10" }).commission_value).toMatch(/first/);
    expect(bad({ commission_value: "" }).commission_value).toMatch(/Type the commission/);
  });

  it("minutes and hours have sensible upper limits", () => {
    const bad = (v: Values) => parseSettings({ ...full, ...v }).errors;
    expect(parseSettings({ ...full, top_window_minutes: "10080", rebook_first_refusal_minutes: "20160", cancel_notice_hours: "168", dispute_window_hours: "720" }).ok).toBe(true);
    expect(bad({ top_window_minutes: "10081" }).top_window_minutes).toBe("At most 10,080 minutes (7 days).");
    expect(bad({ approved_window_minutes: "10081" }).approved_window_minutes).toBeDefined();
    expect(bad({ unclaimed_alert_minutes: "10081" }).unclaimed_alert_minutes).toBeDefined();
    expect(bad({ rebook_first_refusal_minutes: "20161" }).rebook_first_refusal_minutes).toBe("At most 20,160 minutes (14 days).");
    expect(bad({ cancel_notice_hours: "169" }).cancel_notice_hours).toBe("At most 168 hours (7 days).");
    expect(bad({ dispute_window_hours: "721" }).dispute_window_hours).toBe("At most 720 hours (30 days).");
  });

  it("a per-hour commission is pounds, and can't swallow the whole price", () => {
    expect(parseSettings({ ...full, commission_type: "per_hour", commission_value: "5" })).toMatchObject({ ok: true, data: { commission_value: 500 } });
    const r = parseSettings({ ...full, commission_type: "per_hour", commission_value: "22.50" });
    expect(r.ok).toBe(false);
  });
});

describe("settings form: round trip and review", () => {
  it("shows saved values as the text that was typed", () => {
    expect(penceToText(2250)).toBe("22.50");
    expect(penceToText(5)).toBe("0.05");
    expect(bpsToText(2500)).toBe("25");
    expect(bpsToText(1250)).toBe("12.5");
    expect(bpsToText(1205)).toBe("12.05");
    const r = parseSettings(full);
    if (!r.ok) throw new Error("parse");
    const row = { ...empty, ...r.data };
    expect(parseSettings(toValues(row))).toEqual(r);
  });

  it("lists old → new in words, and only what changed", () => {
    const r = parseSettings(full);
    if (!r.ok) throw new Error("parse");
    const c = changes(empty, r.data);
    expect(c.find((x) => x.key === "price_per_hour_pence")).toMatchObject({ from: "Not set", to: "£22.50 an hour" });
    expect(c.find((x) => x.key === "min_booking_minutes")?.to).toBe("2½ hours");
    expect(c.find((x) => x.key === "commission_value")?.to).toBe("12.5% of the price");
    expect(c.some((x) => x.key === "interest_retention_months")).toBe(false);
    expect(changes({ ...empty, ...r.data }, r.data)).toEqual([]);
  });

  it("a commission type change always shows the value's new meaning", () => {
    const a = parseSettings(full);
    const b = parseSettings({ ...full, commission_type: "per_hour", commission_value: "12.50" });
    if (!a.ok || !b.ok) throw new Error("parse");
    const c = changes({ ...empty, ...a.data, commission_value: 1250 }, b.data);
    expect(c.find((x) => x.key === "commission_value")).toMatchObject({ from: "12.5% of the price", to: "£12.50 per hour cleaned" });
  });
});
