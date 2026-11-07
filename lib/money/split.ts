/**
 * How a visit's price splits between the cleaner and Ping.
 *
 * Mirrors private.split_visit_price() in supabase/migrations/…_bookings.sql exactly.
 * Both are tested against tests/fixtures/split-cases.json, so they cannot drift.
 * The database is the source of truth for stored amounts; this copy exists so the
 * site can show an instant price without a round trip.
 *
 *   price    = hourly price × minutes ÷ 60, rounded half up to the penny
 *   fee      = percent:  price × basis points ÷ 10 000, half up
 *              per_hour: fee per hour × minutes ÷ 60, half up
 *   fee is capped at the price; earnings = price − fee
 */
export type CommissionType = "percent" | "per_hour";

export type SplitInput = {
  pricePerHourPence: number;
  durationMinutes: number;
  commissionType: CommissionType;
  /** percent: basis points (2500 = 25%). per_hour: pence per hour. */
  commissionValue: number;
};

export type VisitSplit = {
  pricePence: number;
  pingFeePence: number;
  cleanerEarningsPence: number;
};

function assertWholeNonNegative(name: string, n: number) {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`${name} must be a whole, non-negative number (got ${n})`);
  }
}

/** Integer division rounding half up, for non-negative integers only. */
function divHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

export function splitVisitPrice(input: SplitInput): VisitSplit {
  const { pricePerHourPence, durationMinutes, commissionType, commissionValue } = input;
  assertWholeNonNegative("pricePerHourPence", pricePerHourPence);
  assertWholeNonNegative("durationMinutes", durationMinutes);
  assertWholeNonNegative("commissionValue", commissionValue);
  if (durationMinutes === 0) throw new RangeError("durationMinutes must be more than zero");
  if (commissionType === "percent" && commissionValue > 10_000) {
    throw new RangeError("A percentage commission cannot exceed 100% (10 000 basis points)");
  }

  const pricePence = divHalfUp(pricePerHourPence * durationMinutes, 60);
  const rawFee =
    commissionType === "percent"
      ? divHalfUp(pricePence * commissionValue, 10_000)
      : divHalfUp(commissionValue * durationMinutes, 60);
  const pingFeePence = Math.min(rawFee, pricePence);

  return { pricePence, pingFeePence, cleanerEarningsPence: pricePence - pingFeePence };
}
