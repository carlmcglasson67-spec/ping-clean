import type { Route } from "next";
import { TOWNS } from "./towns";

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
export const AREA_LINKS: (NavLink & { districts: string[] })[] = TOWNS.map((t) => ({
  href: areaHref(t.slug),
  label: t.name,
  districts: t.districts,
}));

export const CLEANERS_LINK: NavLink = { href: "/clean-for-ping", label: "Clean for Ping" };
export const FAQ_LINK: NavLink = { href: "/faq", label: "Help" };
export const AREAS_LINK: NavLink = { href: "/areas", label: "All areas" };
