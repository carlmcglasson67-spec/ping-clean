/**
 * The towns the public site talks about, grouped into Ping's two regions.
 *
 * This is marketing content, not coverage. Whether booking is open in a postcode is
 * decided by settings.launch_districts (read through public_pricing()), never by this list.
 */
export type Region = "carlisle" | "west";

/** Carlisle leads: it is listed first everywhere the site lists areas. */
export const REGIONS: { id: Region; name: string; line: string }[] = [
  { id: "carlisle", name: "Carlisle and around", line: "The city, and out to Wigton, Longtown and Brampton." },
  { id: "west", name: "West Cumbria", line: "From Maryport down the coast to Seascale." },
];

export type Town = {
  slug: string;
  name: string;
  region: Region;
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
    slug: "carlisle",
    name: "Carlisle",
    region: "carlisle",
    districts: ["CA1", "CA2", "CA3"],
    line: "The Border City, castle to cathedral.",
    intro:
      "Victorian terraces around Stanwix and Denton Holme, family homes out in Harraby, Morton and Belah: Carlisle has every kind of home and every kind of week. Book a block of up to 8 cleans and one vetted cleaner does every one, with the same checklist each visit and photos when it’s done.",
    around: ["Stanwix", "Botcherby", "Harraby", "Upperby", "Denton Holme", "Morton", "Belah"],
    near: ["dalston", "wetheral", "brampton"],
  },
  {
    slug: "wetheral",
    name: "Wetheral and Scotby",
    region: "carlisle",
    districts: ["CA4"],
    line: "Villages on the Eden, just east of the city.",
    intro:
      "Wetheral, Scotby and the villages along the Eden are a few minutes from Carlisle but feel a world away. A regular Ping clean fits around commuting and school runs: pick the day and time window, leave a key if you’ll be out, and come home to photos of the finished job.",
    around: ["Scotby", "Cumwhinton", "Warwick Bridge", "Great Corby", "Cotehill"],
    near: ["carlisle", "brampton"],
  },
  {
    slug: "dalston",
    name: "Dalston",
    region: "carlisle",
    districts: ["CA5"],
    line: "South-west of the city, towards the Caldew valley.",
    intro:
      "Dalston and the villages out towards the Solway are spread out, and it can be hard to find a cleaner who’ll come regularly. Ping cleaners choose the areas they cover, so the one who takes on your home is the one who wants to be there.",
    around: ["Burgh by Sands", "Thursby", "Raughton Head"],
    near: ["carlisle", "wigton"],
  },
  {
    slug: "longtown",
    name: "Longtown",
    region: "carlisle",
    districts: ["CA6"],
    line: "North of the city, up towards the Border.",
    intro:
      "Longtown and the farms and villages north of Carlisle are a long way from a cleaning firm’s office. On Ping, one cleaner takes on your whole block, follows the same room-by-room checklist each visit, and your card is charged only once the clean is finished.",
    around: ["Smithfield", "Kirklinton", "Westlinton"],
    near: ["carlisle", "brampton"],
  },
  {
    slug: "wigton",
    name: "Wigton",
    region: "carlisle",
    districts: ["CA7"],
    line: "Market town between the fells and the Solway.",
    intro:
      "From Wigton out to Abbeytown, Aspatria and the Solway coast, homes get the same treatment as everywhere on Ping: one cleaner for your whole block, a proper checklist, and nothing to pay until the clean is finished.",
    around: ["Aspatria", "Abbeytown", "Silloth"],
    near: ["dalston", "carlisle"],
  },
  {
    slug: "brampton",
    name: "Brampton",
    region: "carlisle",
    districts: ["CA8"],
    line: "Little market town on the road to Hadrian’s Wall.",
    intro:
      "Brampton and the villages towards the Wall see plenty of muddy boots. A block of Ping cleans keeps on top of it: one cleaner, the same checklist every visit, and photos when they’re done.",
    around: ["Heads Nook", "Talkin", "Hallbankgate", "Gilsland"],
    near: ["wetheral", "carlisle", "longtown"],
  },
  {
    slug: "workington",
    name: "Workington",
    region: "west",
    districts: ["CA14"],
    line: "Where the Derwent meets the sea.",
    intro:
      "From terraces near the town centre to new builds out towards Seaton, Workington homes are busy homes. A block of Ping cleans means one cleaner on the same day each time, so the kitchen, bathroom and floors are done before the week gets away from you.",
    around: ["Harrington", "Seaton", "Salterbeck", "Moorclose", "Northside", "Stainburn", "Great Clifton"],
    near: ["distington", "maryport", "cockermouth"],
  },
  {
    slug: "whitehaven",
    name: "Whitehaven",
    region: "west",
    districts: ["CA28"],
    line: "Georgian streets, harbour light.",
    intro:
      "Tall town houses near the harbour, family homes up in Hensingham and Mirehouse: Whitehaven has every kind of home and every kind of week. Your Ping cleaner learns yours over your block, follows the same checklist each visit and sends photos when it’s done.",
    around: ["Hensingham", "Kells", "Mirehouse", "Woodhouse", "Sandwith", "Parton", "Moresby"],
    near: ["st-bees", "cleator-moor", "distington"],
  },
  {
    slug: "cockermouth",
    name: "Cockermouth",
    region: "west",
    districts: ["CA13"],
    line: "Market town, where the Cocker meets the Derwent.",
    intro:
      "Cockermouth homes run from Main Street terraces to the estates and villages out on the edge of the fells. Book a block of up to 8 cleans and one vetted cleaner does every one, with a checklist and photos so you can see it’s done even when you’re out at work.",
    around: ["Papcastle", "Brigham", "Eaglesfield", "Great Broughton", "Dovenby"],
    near: ["workington", "maryport", "distington"],
  },
  {
    slug: "maryport",
    name: "Maryport",
    region: "west",
    districts: ["CA15"],
    line: "Harbour town on the Solway coast.",
    intro:
      "From the streets above the harbour to Netherton, Ewanrigg and the villages inland, Maryport homes get the same treatment as everywhere on Ping: one cleaner for your whole block, a proper checklist, and nothing to pay until the clean is finished.",
    around: ["Netherton", "Ewanrigg", "Flimby", "Dearham", "Crosby"],
    near: ["workington", "cockermouth"],
  },
  {
    slug: "egremont",
    name: "Egremont",
    region: "west",
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
    region: "west",
    districts: ["CA25"],
    line: "On the edge of the western fells.",
    intro:
      "Cleator Moor homes, from the square out to Wath Brow, get one cleaner for every clean in their block on Ping. You choose how often, they follow the same room-by-room checklist each visit, and your card is charged only once the clean is finished.",
    around: ["Wath Brow", "Keekle", "Cleator"],
    near: ["frizington", "egremont", "whitehaven"],
  },
  {
    slug: "frizington",
    name: "Frizington",
    region: "west",
    districts: ["CA26"],
    line: "Village life between the coast and the fells.",
    intro:
      "Frizington and the villages up towards Ennerdale are a long way from a cleaning firm’s office, which is why Ping cleaners live locally and choose the areas they cover. Book a block of up to 8 cleans and one cleaner does every one.",
    around: ["Arlecdon", "Rowrah", "Asby"],
    near: ["cleator-moor", "whitehaven"],
  },
  {
    slug: "st-bees",
    name: "St Bees",
    region: "west",
    districts: ["CA27"],
    line: "Red sandstone, sea air, sand on the doormat.",
    intro:
      "Coast walks and a beach on the doorstep mean sand and mud come home with you. A block of Ping cleans keeps on top of it: one cleaner, the same checklist every visit, and photos when they’re done.",
    around: ["St Bees village", "the lanes around St Bees Head"],
    near: ["whitehaven", "egremont"],
  },
  {
    slug: "seascale",
    name: "Seascale",
    region: "west",
    districts: ["CA20"],
    line: "The coast road south, towards the Lakes.",
    intro:
      "Seascale, Gosforth and the homes along the coast road are spread out, and it can be hard to find a cleaner who’ll come regularly. Ping cleaners choose the areas they cover, so the one who takes on your home is the one who wants to be there.",
    around: ["Gosforth", "Drigg", "Beckermet"],
    near: ["egremont", "st-bees"],
  },
  {
    slug: "distington",
    name: "Distington",
    region: "west",
    districts: ["CA14"],
    line: "Between Workington and Whitehaven.",
    intro:
      "Distington, Lowca and High Harrington sit between the two big towns, which makes them easy for local cleaners to reach. Book a block of up to 8 cleans and one vetted cleaner does every one, with a checklist and photos to show it’s done.",
    around: ["Lowca", "High Harrington", "Pica"],
    near: ["workington", "whitehaven", "cockermouth"],
  },
];

export function townsIn(region: Region): Town[] {
  return TOWNS.filter((t) => t.region === region);
}

export function townBySlug(slug: string): Town | undefined {
  return TOWNS.find((t) => t.slug === slug);
}
