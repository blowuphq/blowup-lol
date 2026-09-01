import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  console.log('\n=== Checking for payment_id: pay_0NmWhM9A3mCVI3E0UIB2q ===\n');

  // Check bids table for this payment_id
  const bids = await pool.query(`
    SELECT id, creator_id, amount_cents, payment_status,
           stripe_payment_intent_id as payment_id,
           created_at
    FROM bids
    WHERE stripe_payment_intent_id = $1
  `, ['pay_0NmWhM9A3mCVI3E0UIB2q']);

  console.log('Bids with payment_id pay_0NmWhM9A3mCVI3E0UIB2q:');
  console.log(bids.rows.length ? bids.rows : '  (none found)');

  // Check for @mkbhd creator
  const creator = await pool.query(`
    SELECT id, handle, name
    FROM creators
    WHERE handle = $1
  `, ['@mkbhd']);

  console.log('\n@mkbhd creator:');
  console.log(creator.rows.length ? creator.rows : '  (none found)');

  // If creator exists, check their bids
  if (creator.rows.length > 0) {
    const creatorBids = await pool.query(`
      SELECT id, amount_cents, payment_status,
             stripe_payment_intent_id as payment_id,
             created_at
      FROM bids
      WHERE creator_id = $1
      ORDER BY created_at DESC
      LIMIT 5
    `, [creator.rows[0].id]);

    console.log('\nRecent bids for @mkbhd:');
    console.log(creatorBids.rows.length ? creatorBids.rows : '  (none found)');
  }

  // Check webhook_events table
  const webhookEvent = await pool.query(`
    SELECT id, type, received_at, processed_at
    FROM webhook_events
    WHERE id = $1
  `, ['pay_0NmWhM9A3mCVI3E0UIB2q']);

  console.log('\nWebhook event for payment_id:');
  console.log(webhookEvent.rows.length ? webhookEvent.rows : '  (none found)');

  // Check all recent webhook events
  const recentWebhooks = await pool.query(`
    SELECT id, type, received_at, processed_at
    FROM webhook_events
    ORDER BY received_at DESC
    LIMIT 5
  `);

  console.log('\nMost recent webhook events:');
  console.log(recentWebhooks.rows.length ? recentWebhooks.rows : '  (none found)');

  await pool.end();
}

check().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
