import { desc, eq, and } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { activities, creators } from '../../db/schema.js';

/** Public "recent activity" feed reads (architecture §2 activities). */

export interface FeedEntry {
  id: number;
  type: 'bid' | 'rank_change' | 'joined_board';
  handle: string;
  previousRank: number | null;
  newRank: number | null;
  amountCents: number | null;
  createdAt: Date;
}

export async function listSeasonFeed(seasonId: string, limit = 50): Promise<FeedEntry[]> {
  const rows = await db
    .select({
      id: activities.id,
      type: activities.type,
      handle: creators.handle,
      previousRank: activities.previousRank,
      newRank: activities.newRank,
      amountCents: activities.amountCents,
      createdAt: activities.createdAt,
    })
    .from(activities)
    .innerJoin(creators, eq(creators.id, activities.creatorId))
    .where(and(eq(activities.seasonId, seasonId)))
    .orderBy(desc(activities.id))
    .limit(limit);
  return rows;
}
