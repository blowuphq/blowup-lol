/**
 * ONE-OFF VERIFICATION SCRIPT — Phase 5.0 Risk R3
 *
 * This script was used to verify Dodo's pay-what-you-want behavior against the real sandbox
 * BEFORE implementing Phase 5.0. It confirmed that checkout sessions honor dynamically-passed
 * amounts and the preview endpoint reflects those amounts correctly.
 *
 * Status: COMPLETED 2026-08-30
 * Result: R3 VERIFIED — checkout API honors ProductItemReq.amount for PWYW products
 *
 * This is NOT production code. It can be deleted after Phase 5.0 is merged, or kept as
 * documentation of the pre-implementation verification step.
 */

import 'dotenv/config';
import Dodo from 'dodopayments';

const DODO_API_KEY = process.env.DODO_API_KEY;
const DODO_BID_PRODUCT_ID = process.env.DODO_BID_PRODUCT_ID;

if (!DODO_API_KEY) {
  console.error('Error: DODO_API_KEY not found in environment');
  process.exit(1);
}

if (!DODO_BID_PRODUCT_ID) {
  console.error('Error: DODO_BID_PRODUCT_ID not found in environment');
  process.exit(1);
}

const client = new Dodo({
  bearerToken: DODO_API_KEY,
  environment: 'test_mode'
});

async function verifyR3() {
  console.log('R3 Verification: Pay-what-you-want amount handling\n');
  console.log(`Product ID: ${DODO_BID_PRODUCT_ID}`);
  console.log(`Testing amount: 1500 cents ($15.00)`);
  console.log(`  (above $5 floor, below $25 suggested)\n`);

  try {
    const session = await client.checkoutSessions.create({
      product_cart: [{
        product_id: DODO_BID_PRODUCT_ID!,
        quantity: 1,
        amount: 1500, // $15 — above floor ($5), below suggested ($25)
      }],
      metadata: { test: 'r3-verification', timestamp: new Date().toISOString() },
      return_url: 'http://localhost:3000/?test=r3-success',
      billing_currency: 'USD',
    });

    console.log('✓ Checkout session created successfully\n');
    console.log(`Session ID: ${session.session_id}`);
    console.log(`Checkout URL: ${session.checkout_url}\n`);

    // Now try to preview or retrieve the session to see if amount is reflected
    console.log('Attempting to preview the session to verify amount...\n');

    try {
      const preview = await client.checkoutSessions.preview({
        product_cart: [{
          product_id: DODO_BID_PRODUCT_ID!,
          quantity: 1,
          amount: 1500,
        }],
        billing_currency: 'USD',
      });

      console.log('✓ Preview retrieved successfully\n');
      console.log('Preview response:', JSON.stringify(preview, null, 2));

      // @ts-expect-error - checking for total_amount field
      if (preview.total_amount !== undefined) {
        // @ts-expect-error
        const totalCents = preview.total_amount;
        const totalDollars = (totalCents / 100).toFixed(2);
        console.log(`\n✓✓ VERIFICATION RESULT: total_amount = ${totalCents} cents ($${totalDollars})`);

        if (totalCents === 1500) {
          console.log('✓✓✓ SUCCESS: The preview reflects the dynamically-passed amount (1500), not the floor (500) or suggested (2500)');
        } else {
          console.log(`⚠ WARNING: Expected 1500, got ${totalCents}`);
        }
      } else {
        console.log('\n⚠ Preview does not contain total_amount field');
        console.log('To complete verification: visit the checkout URL, complete payment, and observe the webhook\'s total_amount');
      }
    } catch (previewError) {
      console.log('Preview API call failed:', previewError);
      console.log('\nTo complete verification: visit the checkout URL above, complete payment, and observe the webhook\'s total_amount');
    }

  } catch (error) {
    console.error('\n✗ Error creating checkout session:', error);
    process.exit(1);
  }
}

verifyR3();
