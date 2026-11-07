import { ButtonLink, PingMark, Wordmark } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col px-5 py-6 sm:px-10 lg:px-16">
      <Wordmark />
      <div className="my-auto grid max-w-3xl gap-6 py-20">
        <PingMark pulse />
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-ink">Page not found</p>
        <h1 className="text-3xl font-semibold">Nothing to clean here.</h1>
        <p className="text-lg text-navy-2">That page has moved or never existed. Head back and we&rsquo;ll get you where you were going.</p>
        <div>
          <ButtonLink href="/" size="lg" variant="ink">
            Back to Ping
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
