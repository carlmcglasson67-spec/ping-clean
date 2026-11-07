/**
 * Questions people ask before they book. One source for the home page (featured)
 * and the full FAQ page. Answers state no prices, fees or notice periods: those live in
 * the settings table and are shown by the instant price, never written into copy.
 */
export type Faq = { q: string; a: string; featured?: boolean };
export type FaqGroup = { id: string; title: string; items: Faq[] };

export const FAQ: FaqGroup[] = [
  {
    id: "booking",
    title: "Booking and price",
    items: [
      {
        q: "How much does a clean cost?",
        a: "One fixed hourly rate, the same in every town, set by Ping rather than haggled with a cleaner. Put in your postcode and the hours you want and you see the exact price per clean before you book. There is a minimum booking, so every visit is long enough to do properly.",
        featured: true,
      },
      {
        q: "How many hours should I book?",
        a: "If you’re not sure, start with the minimum. After the first visit your cleaner will tell you honestly whether your home needs a little more time or a little less, and we’ll adjust it with you.",
      },
      {
        q: "How often can I have a clean?",
        a: "Every week, every two weeks or every four weeks, on the day that suits you. Most homes settle on weekly or fortnightly.",
        featured: true,
      },
      {
        q: "Do I need to be in?",
        a: "No. Plenty of customers leave a key or give a key safe code. Your address details and key code are only shown to your cleaner once they’ve taken on your clean, never to anyone browsing for work.",
      },
    ],
  },
  {
    id: "cleaner",
    title: "Your cleaner",
    items: [
      {
        q: "Will I get the same cleaner every time?",
        a: "Yes. Your regular clean is taken on by one cleaner as a whole arrangement, not visit by visit, so the same person comes each time and gets to know your home.",
        featured: true,
      },
      {
        q: "How are Ping cleaners checked?",
        a: "Before a cleaner can see a single job we verify four things: a DBS check, public liability insurance, photo ID and their right to work in the UK. Then every clean they do is scored, and the best get first pick of new work.",
        featured: true,
      },
      {
        q: "What happens if my cleaner is off or stops working with Ping?",
        a: "Your clean goes straight back to our vetted cleaners and we keep you posted until someone has taken it on. If a cleaner ever misses a visit, we’ll offer you a replacement or your money back. You’re never left to sort it out yourself.",
      },
      {
        q: "Are the cleaners employed by Ping?",
        a: "No. Ping cleaners are self-employed professionals who choose their own areas and hours. Ping introduces you, handles the booking and payment, and checks the quality of every clean.",
      },
    ],
  },
  {
    id: "visit",
    title: "On the day",
    items: [
      {
        q: "What does a regular clean include?",
        a: "Kitchen worktops, hob, sink and cupboard fronts; toilet, bath, shower, basin and mirrors; dusting, beds made, hoovering, mopping and bins. Your cleaner works through the same room-by-room checklist every visit. Extras such as oven cleans and ironing aren’t part of a regular Ping clean yet.",
        featured: true,
      },
      {
        q: "How do I know it’s been done properly?",
        a: "Your cleaner ticks off each item on the checklist and takes before and after photos, which you can see in your account. You rate every clean, and the Ping team reviews them too.",
      },
    ],
  },
  {
    id: "paying",
    title: "Paying and changing plans",
    items: [
      {
        q: "When do I pay?",
        a: "Your card is saved securely when you book, and charged only after each clean is finished. Nothing is taken in advance.",
        featured: true,
      },
      {
        q: "Can I skip or cancel a visit?",
        a: "Yes, from your account. Give your cleaner fair notice and there’s nothing to pay. Very late cancellations carry a fee, part of which goes to your cleaner for the time they kept free. You’ll see the exact notice period before you book.",
      },
    ],
  },
];

export const FEATURED_FAQ: Faq[] = FAQ.flatMap((g) => g.items.filter((i) => i.featured));
