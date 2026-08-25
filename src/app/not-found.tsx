import Link from 'next/link';

/** Dark-theme 404 (architecture §1 not-found.tsx). */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center text-zinc-100">
      <p className="text-[clamp(4rem,14vw,8rem)] font-bold leading-none tracking-tighter text-hot">
        404
      </p>
      <p className="text-lg font-bold">That board doesn&apos;t exist.</p>
      <p className="text-sm text-zinc-500">
        The category you followed is inactive or never was.
      </p>
      <Link
        href="/categories"
        className="mt-2 rounded-full border border-hot/40 bg-hot/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-hot transition-colors hover:bg-hot/20"
      >
        See live boards →
      </Link>
    </main>
  );
}
