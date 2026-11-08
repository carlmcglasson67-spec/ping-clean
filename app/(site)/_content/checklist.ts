/**
 * What a standard regular clean covers, as the customer reads it on the site.
 * Mirrors the default checklist template the cleaner ticks off in the app
 * (checklist_templates where is_default). If the template changes, change this too.
 */
export type Room = { room: string; items: string[] };

export const STANDARD_CLEAN: Room[] = [
  {
    room: "Kitchen",
    items: [
      "Worktops, splashbacks and hob wiped and dried",
      "Sink and taps cleaned and polished",
      "Outside of appliances and cupboard fronts wiped",
    ],
  },
  {
    room: "Bathroom",
    items: ["Toilet cleaned inside and out", "Bath, shower and screen cleaned", "Basin, taps and mirror polished"],
  },
  {
    room: "Bedrooms and living areas",
    items: ["Reachable surfaces dusted", "Beds made, with linen changed if you leave it out"],
  },
  {
    room: "Whole home",
    items: ["Carpets and rugs hoovered", "Hard floors mopped", "Bins emptied and bags replaced"],
  },
];

/** Total ticks on a standard clean, for the "11 of 11" proof moments. */
export const STANDARD_CLEAN_COUNT = STANDARD_CLEAN.reduce((n, r) => n + r.items.length, 0);
