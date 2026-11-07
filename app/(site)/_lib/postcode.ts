/**
 * UK postcode parsing for the instant price. Display and coverage only: checkout
 * validates the full address again on the server before anything is stored.
 *
 * Normalised form matches the properties.postcode check constraint exactly:
 * upper case, one space, e.g. "CA14 3XX".
 */
const FULL = /^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$/;
const DISTRICT = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;

export type ParsedPostcode =
  | { kind: "full"; postcode: string; district: string }
  | { kind: "district"; district: string }
  | { kind: "invalid" }
  | { kind: "empty" };

export function parsePostcode(input: string): ParsedPostcode {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return { kind: "empty" };
  const full = FULL.exec(compact);
  if (full) {
    const [, out, inward] = full as unknown as [string, string, string];
    return { kind: "full", postcode: `${out} ${inward}`, district: out };
  }
  // Someone typing just "CA14" still gets an answer about their area.
  if (compact.length <= 4 && DISTRICT.test(compact)) return { kind: "district", district: compact };
  return { kind: "invalid" };
}
