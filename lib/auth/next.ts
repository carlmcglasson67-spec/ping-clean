/**
 * ?next= handling for sign-in, sign-up and email links. A crafted link must never send
 * anyone off Ping (open redirect) or somewhere unexpected inside it.
 *
 * Allowlist: only paths inside the three apps. Anything else (absolute URLs,
 * protocol-relative "//", backslashes, control characters, public pages) is dropped and
 * the person goes to their own home instead.
 */
const ALLOWED_PREFIXES = ["/account", "/work", "/admin"] as const;
const BASE = "https://ping.invalid";
const MAX = 512;

/** The normalised path (with query, without fragment) if it's allowed, else null. */
export function safeNext(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const path = url.pathname; // dot segments are resolved here: "/account/../admin" -> "/admin"
  if (path.startsWith("//")) return null;
  const allowed = ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  return allowed ? path + url.search : null;
}

/** Path part only, for matching against areas. */
export function pathOf(next: string): string {
  const q = next.indexOf("?");
  return q === -1 ? next : next.slice(0, q);
}
