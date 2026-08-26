import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '../../../lib/db.js';
import { categories } from '../../../db/schema.js';
import { loadBoard } from '../../../features/leaderboard/board.js';
import type { CategoryChipData } from '../../../components/shared/CategoryChips.js';
import LeaderboardScreen from './LeaderboardScreen.js';

/**
 * Live category leaderboard (architecture §1 (board)/[category]/page.tsx):
 * SSR the current board (Redis fast path, PG circuit-break), then hand off
 * to the client screen for SSE-driven live updates.
 *
 * Phase 4.5: also resolves every active category's season total for the
 * chip selector. Best-effort — a chips failure renders the page without
 * chips, never without the board.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<{ title: string }> {
  const { category } = await params;
  return { title: `${category} leaderboard — Blowup` };
}

const seasonTotal = (rows: { bidTotalCents: number }[]): number =>
  rows.reduce((sum, r) => sum + r.bidTotalCents, 0);

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: slug } = await params;
  let board;
  try {
    board = await loadBoard(slug);
  } catch {
    notFound();
  }

  let chips: CategoryChipData[] | undefined;
  try {
    const cats = await db.select().from(categories).where(eq(categories.active, true));
    const totals = await Promise.all(
      cats.map(async (c) => {
        if (c.slug === slug) return seasonTotal(board.rows);
        try {
          return seasonTotal((await loadBoard(c.slug)).rows);
        } catch {
          return 0; // one cold category must not blank the whole chip row
        }
      }),
    );
    chips = cats.map((c, i) => ({ slug: c.slug, name: c.name, totalCents: totals[i] ?? 0 }));
  } catch {
    chips = undefined;
  }

  return <LeaderboardScreen initial={board} chips={chips} />;
}
