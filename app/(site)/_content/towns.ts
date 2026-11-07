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
};

export const TOWNS: Town[] = [
  { slug: "workington", name: "Workington", districts: ["CA14"] },
  { slug: "whitehaven", name: "Whitehaven", districts: ["CA28"] },
  { slug: "cockermouth", name: "Cockermouth", districts: ["CA13"] },
  { slug: "maryport", name: "Maryport", districts: ["CA15"] },
  { slug: "egremont", name: "Egremont", districts: ["CA22"] },
  { slug: "cleator-moor", name: "Cleator Moor", districts: ["CA25"] },
  { slug: "frizington", name: "Frizington", districts: ["CA26"] },
  { slug: "st-bees", name: "St Bees", districts: ["CA27"] },
  { slug: "seascale", name: "Seascale", districts: ["CA20"] },
  { slug: "distington", name: "Distington", districts: ["CA14"] },
];
