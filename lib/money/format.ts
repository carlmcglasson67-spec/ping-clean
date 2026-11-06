const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const gbpWhole = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

/** 5000 → "£50.00". Pence in, display string out. Never do arithmetic on the result. */
export function formatPence(pence: number): string {
  if (!Number.isSafeInteger(pence)) throw new RangeError(`Money must be whole pence (got ${pence})`);
  return gbp.format(pence / 100);
}

/** 5000 → "£50", 5050 → "£50.50". For headline prices where trailing zeros look clumsy. */
export function formatPenceShort(pence: number): string {
  if (!Number.isSafeInteger(pence)) throw new RangeError(`Money must be whole pence (got ${pence})`);
  return pence % 100 === 0 ? gbpWhole.format(pence / 100) : gbp.format(pence / 100);
}

/** 150 → "2½ hours", 60 → "1 hour", 90 → "1½ hours". Durations are always multiples of 30. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const half = minutes % 60 === 30;
  const rest = minutes % 60;
  if (rest !== 0 && !half) return `${minutes} minutes`;
  if (hours === 0) return "½ hour";
  const label = `${hours}${half ? "½" : ""}`;
  return `${label} ${hours === 1 && !half ? "hour" : "hours"}`;
}
