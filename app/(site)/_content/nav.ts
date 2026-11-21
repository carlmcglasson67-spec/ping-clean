import type { Route } from "next";
import { REGIONS, TOWNS, townsIn, type Region } from "./towns";

export type NavLink = { href: Route; label: string; note?: string };

/** "Regular cleaning" mega-menu column. */
export const CLEANING_LINKS: NavLink[] = [
  { href: "/#how", label: "How it works", note: "Five steps from postcode to a clean home" },
  { href: "/#included", label: "What’s included", note: "The room-by-room checklist on every visit" },
  { href: "/#promises", label: "Why Ping", note: "One cleaner per block, checked, proof, pay after" },
  { href: "/faq", label: "Questions", note: "Price, access, cancelling and more" },
];

export function areaHref(slug: string): Route {
  return `/areas/${slug}` as Route;
}

/** Areas mega-menu: every town, with its postcode district. */
export const AREA_LINKS: AreaLink[] = TOWNS.map((t) => ({
  href: areaHref(t.slug),
  label: t.name,
  districts: t.districts,
}));

export type AreaLink = NavLink & { districts: string[] };

/** The same links, grouped by region in the order the site lists them (Carlisle first). */
export const AREA_GROUPS: { id: Region; name: string; line: string; links: AreaLink[] }[] = REGIONS.map((r) => ({
  ...r,
  links: townsIn(r.id).map((t) => ({ href: areaHref(t.slug), label: t.name, districts: t.districts })),
}));

/** "Sixteen towns and villages", counted rather than typed, so adding one keeps the wording true. */
export function townCount(): string {
  const words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];
  return `${words[TOWNS.length] ?? TOWNS.length} towns and villages`;
}

export const CLEANERS_LINK: NavLink = { href: "/clean-for-ping", label: "Clean for Ping" };
export const FAQ_LINK: NavLink = { href: "/faq", label: "Help" };
export const AREAS_LINK: NavLink = { href: "/areas", label: "All areas" };
