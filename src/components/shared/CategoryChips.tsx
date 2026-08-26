import Link from 'next/link';

/**
 * Category chip selector (Phase 4.5, item 5): compact horizontal scan of
 * every active category with its season total raised — activity level at a
 * glance, one tap to switch boards. Pure presentational; callers supply the
 * totals (already in hand wherever a board is loaded).
 */
export function CategoryChip({
  chip,
  active = false,
}: {
  chip: { slug: string; name: string; totalCents: number };
  active?: boolean;
}) {
  const cls = active
    ? 'border-hot/60 bg-hot/15 text-hot'
    : 'border-white/10 text-zinc-400 hover:border-hot/40 hover:text-zinc-100';
  return (
    <Link
      href={`/${chip.slug}`}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-bold uppercase tracking-widest transition-colors ${cls}`}
    >
      {chip.name}
      <span className="tabular-nums tracking-normal opacity-80">
        ${(chip.totalCents / 100).toLocaleString('en-US')}
      </span>
    </Link>
  );
}

export interface CategoryChipData {
  slug: string;
  name: string;
  totalCents: number;
}

export function CategoryChips({
  chips,
  activeSlug,
}: {
  chips: CategoryChipData[];
  activeSlug?: string;
}) {
  if (chips.length === 0) return null;
  return (
    <nav aria-label="Categories" className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <CategoryChip key={c.slug} chip={c} active={c.slug === activeSlug} />
      ))}
    </nav>
  );
}
