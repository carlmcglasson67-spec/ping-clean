import { describe, expect, it } from "vitest";
import { checklistProgress, isRealReason, itemChange, PHOTO_PATH, photoPath } from "./visit";

const v = "00000000-0000-4000-e000-000000000002";
const i = "3f2a6c1e-8b0d-4c7a-9e5f-2d1b0a9c8e7f";

describe("couldn't-do reasons match the database rule", () => {
  it("needs a real word of three or more letters or digits", () => {
    expect(isRealReason("No access to the back bedroom")).toBe(true);
    expect(isRealReason("Dog")).toBe(true);
    expect(isRealReason("Rm 101")).toBe(true);
    expect(isRealReason("Pièce fermée")).toBe(true);
    for (const bad of ["", "   ", "...", "n/a", "no", "a b c", " ​"]) expect(isRealReason(bad)).toBe(false);
    expect(isRealReason("x".repeat(301))).toBe(false);
  });

  it("an item is ticked or couldn't be done, never both", () => {
    expect(itemChange.safeParse({ visitId: v, itemId: i, done: true, reason: null }).success).toBe(true);
    expect(itemChange.safeParse({ visitId: v, itemId: i, done: false, reason: "Locked room" }).success).toBe(true);
    expect(itemChange.safeParse({ visitId: v, itemId: i, done: false, reason: null }).success).toBe(true); // undo
    expect(itemChange.safeParse({ visitId: v, itemId: i, done: true, reason: "Locked room" }).success).toBe(false);
    expect(itemChange.safeParse({ visitId: v, itemId: i, done: false, reason: "..." }).success).toBe(false);
  });
});

describe("visit photos", () => {
  it("live in the visit's own folder, under a name that's never reused", () => {
    const p = photoPath(v, "before", "jpg", i);
    expect(p).toBe(`${v}/before-${i}.jpg`);
    expect(PHOTO_PATH.exec(p)?.[1]).toBe(v);
    expect(/^[0-9a-f-]{36}\/[^/]+$/.test(p)).toBe(true); // visit_photos.storage_path check
    for (const bad of [`${v}/../x/before-${i}.jpg`, `${v}/during-${i}.jpg`, `${v}/before-${i}.exe`]) expect(PHOTO_PATH.test(bad)).toBe(false);
  });
});

describe("checklist progress", () => {
  it("counts ticked and properly explained items as resolved", () => {
    expect(checklistProgress([
      { done: true, skipped_reason: null },
      { done: false, skipped_reason: "No access to the loft" },
      { done: false, skipped_reason: null },
    ])).toEqual({ resolved: 2, total: 3, left: 1 });
  });
});
