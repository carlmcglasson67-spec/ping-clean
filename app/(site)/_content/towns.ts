/**
 * The West Cumbria towns the public site talks about.
 *
 * This is marketing content, not coverage. Whether booking is open in a postcode is
 * decided by settings.launch_districts (read through public_pricing()), never by this list.
 */
export type Town = {
  slug: string;
  name: string;
  /** Outward postcode districts the town sits in, e.g. "CA14". */
  districts: string[];
  /** One line of place, used under the page title. */
  line: string;
  /** Opening paragraph for the area page. */
  intro: string;
  /** Neighbourhoods and villages the page names. */
  around: string[];
  /** Slugs of the nearest towns, for the "nearby" links. */
  near: string[];
};

export const TOWNS: Town[] = [
  {
    slug: "workington",
    name: "Workington",
    districts: ["CA14"],
    line: "Where the Derwent meets the sea.",
    intro:
      "From terraces near the town centre to new builds out towards Seaton, Workington homes are busy homes. A regular Ping clean means the same cleaner on the same day, so the kitchen, bathroom and floors are done before the week gets away from you.",
    around: ["Harrington", "Seaton", "Salterbeck", "Moorclose", "Northside", "Stainburn", "Great Clifton"],
    near: ["distington", "maryport", "cockermouth"],
  },
  {
    slug: "whitehaven",
    name: "Whitehaven",
    districts: ["CA28"],
    line: "Georgian streets, harbour light.",
    intro:
      "Tall town houses near the harbour, family homes up in Hensingham and Mirehouse: Whitehaven has every kind of home and every kind of week. Your regular Ping cleaner learns yours, follows the same checklist each visit and sends photos when it’s done.",
    around: ["Hensingham", "Kells", "Mirehouse", "Woodhouse", "Sandwith", "Parton", "Moresby"],
    near: ["st-bees", "cleator-moor", "distington"],
  },
  {
    slug: "cockermouth",
    name: "Cockermouth",
    districts: ["CA13"],
    line: "Market town, where the Cocker meets the Derwent.",
    intro:
      "Cockermouth homes run from Main Street terraces to the estates and villages out on the edge of the fells. Book a regular clean once and the same vetted cleaner comes every visit, with a checklist and photos so you can see it’s done even when you’re out at work.",
    around: ["Papcastle", "Brigham", "Eaglesfield", "Great Broughton", "Dovenby"],
    near: ["workington", "maryport", "distington"],
  },
  {
    slug: "maryport",
    name: "Maryport",
    districts: ["CA15"],
    line: "Harbour town on the Solway coast.",
    intro:
      "From the streets above the harbour to Netherton, Ewanrigg and the villages inland, Maryport homes get the same treatment as everywhere on Ping: one cleaner who knows your home, a proper checklist, and nothing to pay until the clean is finished.",
    around: ["Netherton", "Ewanrigg", "Flimby", "Dearham", "Crosby"],
    near: ["workington", "cockermouth"],
  },
  {
    slug: "egremont",
    name: "Egremont",
    districts: ["CA22"],
    line: "Market town on the River Ehen.",
    intro:
      "Plenty of people around Egremont work shifts, and a regular Ping clean fits around them: pick the day and time window, leave a key if you’ll be out, and come home to a clean house and photos to prove it.",
    around: ["Thornhill", "Bigrigg", "Haile"],
    near: ["cleator-moor", "st-bees", "seascale"],
  },
  {
    slug: "cleator-moor",
    name: "Cleator Moor",
    districts: ["CA25"],
    line: "On the edge of the western fells.",
    intro:
      "Cleator Moor homes, from the square out to Wath Brow, get the same cleaner every visit on Ping. You choose how often, they follow the same room-by-room checklist every time, and your card is charged only once the clean is finished.",
    around: ["Wath Brow", "Keekle", "Cleator"],
    near: ["frizington", "egremont", "whitehaven"],
  },
  {
    slug: "frizington",
    name: "Frizington",
    districts: ["CA26"],
    line: "Village life between the coast and the fells.",
    intro:
      "Frizington and the villages up towards Ennerdale are a long way from a cleaning firm’s office, which is why Ping cleaners live locally and choose the areas they cover. Book once and the same cleaner comes every visit.",
    around: ["Arlecdon", "Rowrah", "Asby"],
    near: ["cleator-moor", "whitehaven"],
  },
  {
    slug: "st-bees",
    name: "St Bees",
    districts: ["CA27"],
    line: "Red sandstone, sea air, sand on the doormat.",
    intro:
      "Coast walks and a beach on the doorstep mean sand and mud come home with you. A regular Ping clean keeps on top of it: the same cleaner, the same checklist every visit, and photos when they’re done.",
    around: ["St Bees village", "the lanes around St Bees Head"],
    near: ["whitehaven", "egremont"],
  },
  {
    slug: "seascale",
    name: "Seascale",
    districts: ["CA20"],
    line: "The coast road south, towards the Lakes.",
    intro:
      "Seascale, Gosforth and the homes along the coast road are spread out, and it can be hard to find a cleaner who’ll come every week. Ping cleaners choose the areas they cover, so the one who takes on your home is the one who wants to be there.",
    around: ["Gosforth", "Drigg", "Beckermet"],
    near: ["egremont", "st-bees"],
  },
  {
    slug: "distington",
    name: "Distington",
    districts: ["CA14"],
    line: "Between Workington and Whitehaven.",
    intro:
      "Distington, Lowca and High Harrington sit between the two big towns, which makes them easy for local cleaners to reach. Book once and the same vetted cleaner comes every visit, with a checklist and photos to show it’s done.",
    around: ["Lowca", "High Harrington", "Pica"],
    near: ["workington", "whitehaven", "cockermouth"],
  },
];

export function townBySlug(slug: string): Town | undefined {
  return TOWNS.find((t) => t.slug === slug);
}
