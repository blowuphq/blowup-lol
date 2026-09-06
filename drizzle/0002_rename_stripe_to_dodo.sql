-- Rename Stripe columns to Dodo equivalents
ALTER TABLE "bids" RENAME COLUMN "stripe_checkout_session_id" TO "dodo_checkout_session_id";
ALTER TABLE "bids" RENAME COLUMN "stripe_payment_intent_id" TO "dodo_payment_id";

-- Rename the unique index
DROP INDEX IF EXISTS "bids_payment_intent_unique";
CREATE UNIQUE INDEX "bids_payment_id_unique" ON "bids" USING btree ("dodo_payment_id");

-- Update the trigger comment (it's in the function body)
-- The trigger function already references the columns by their old names in comments only
-- The actual column references in the function body use NEW/OLD.column_name which are updated automatically