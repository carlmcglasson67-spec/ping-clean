import type { Route } from "next";
import { TOWNS } from "./towns";

export type NavLink = { href: Route; label: string; note?: string };

/** "Regular cleaning" mega-menu column. */
export const CLEANING_LINKS: NavLink[] = [
  { href: "/#how", label: "How it works", note: "Five steps from postcode to a clean home" },
  { href: "/#included", label: "What’s included", note: "The room-by-room checklist on every visit" },
  { href: "/#promises", label: "Why Ping", note: "Same cleaner, checked, proof, pay after" },
  { href: "/#faq", label: "Questions", note: "Price, access, cancelling and more" },
];

/** Areas mega-menu: every town, with its postcode district. */
export const AREA_LINKS: (NavLink & { districts: string[] })[] = TOWNS.map((t) => ({
  href: "/#areas" as Route,
  label: t.name,
  districts: t.districts,
}));

export const CLEANERS_LINK: NavLink = { href: "/#cleaners", label: "Clean for Ping" };
