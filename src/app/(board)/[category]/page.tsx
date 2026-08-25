import { notFound } from 'next/navigation';
import { loadBoard } from '../../../features/leaderboard/board.js';
import LeaderboardScreen from './LeaderboardScreen.js';

/**
 * Live category leaderboard (architecture §1 (board)/[category]/page.tsx):
 * SSR the current board (Redis fast path, PG circuit-break), then hand off
 * to the client screen for SSE-driven live updates.
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
  return <LeaderboardScreen initial={board} />;
}
