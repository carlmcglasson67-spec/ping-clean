import { EmptyState, PageHeader } from "@/components/ui";

/**
 * A section whose screen is still being built (each arrives in its own pull request).
 * Says so plainly, and what happens in the meantime, rather than a blank page or a 404.
 */
export function ComingSoon({ eyebrow, title, lede, meanwhile }: { eyebrow: string; title: string; lede: string; meanwhile: string }) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} lede={lede} />
      <EmptyState title="This part of the console is on its way">{meanwhile}</EmptyState>
    </>
  );
}
