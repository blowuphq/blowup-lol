import 'dotenv/config';
import { and, eq, count } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { categories, creators, seasons } from '../src/db/schema.js';

/**
 * Phase 1 seed (architecture §2): 3 launch categories + one ACTIVE season each.
 * Idempotent — safe to run repeatedly; never resurrects a manually deactivated
 * category (ON CONFLICT DO NOTHING) and never creates a second active season.
 */

const LAUNCH_CATEGORIES = [
  { slug: 'tech', name: 'Tech' },
  { slug: 'gaming', name: 'Gaming' },
  { slug: 'education', name: 'Education' },
] as const;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(categories).values(LAUNCH_CATEGORIES.map((c) => ({ ...c }))).onConflictDoNothing({
        target: categories.slug,
      });

      for (const { slug } of LAUNCH_CATEGORIES) {
        const [category] = await tx.select().from(categories).where(eq(categories.slug, slug));
        if (!category) throw new Error(`seed bug: category ${slug} missing after upsert`);

        const [existingActive] = await tx
          .select()
          .from(seasons)
          .where(and(eq(seasons.categoryId, category.id), eq(seasons.status, 'active')));

        if (!existingActive) {
          await tx.insert(seasons).values({
            categoryId: category.id,
            startsAt: new Date(),
            endsAt: new Date(Date.now() + SEVEN_DAYS_MS),
            status: 'active',
          });
        }
      }
    });

    const [catCount] = await db.select({ value: count() }).from(categories);
    const [activeSeasonCount] = await db
      .select({ value: count() })
      .from(seasons)
      .where(eq(seasons.status, 'active'));
    const [creatorCount] = await db.select({ value: count() }).from(creators);

    console.log('Seed complete:');
    console.log(`  categories:      ${catCount.value} (expected 3)`);
    console.log(`  active seasons:  ${activeSeasonCount.value} (expected 3)`);
    console.log(`  creators:        ${creatorCount.value} (expected 0)`);

    if (catCount.value !== 3 || activeSeasonCount.value !== 3 || creatorCount.value !== 0) {
      throw new Error('seed verification failed: counts do not match expected state');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
