import type { NextRequest } from 'next/server';
import { loadBoard } from '../../../../features/leaderboard/board.js';

/**
 * Board snapshot JSON (architecture §3 Phase C): the client's "one fresh
 * fetch" after (re)connect, resyncing it onto absolute truth no matter what
 * replayed deltas it just applied.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ category: string }> },
): Promise<Response> {
  const { category } = await params;
  try {
    const board = await loadBoard(category);
    return Response.json(board, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error(`[board] snapshot failed for '${category}':`, err);
    return Response.json({ error: `unknown or inactive category: ${category}` }, { status: 404 });
  }
}
