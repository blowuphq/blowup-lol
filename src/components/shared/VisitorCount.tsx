/**
 * Live viewer chip (architecture §1 components/shared/VisitorCount).
 * Presentational — the SSE screen owns the count state.
 */
export function VisitorCount({ count }: { count: number | null }) {
  return (
    <span
      title="Live viewers on this board"
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium uppercase tracking-widest text-zinc-300"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-hot opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-hot" />
      </span>
      {count === null ? '—' : count} watching
    </span>
  );
}
