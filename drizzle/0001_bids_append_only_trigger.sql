-- bids is APPEND-ONLY (approved architecture §2/§9):
--   * DELETE always raises.
--   * Financial-history columns (amount_cents, creator_id, campaign_id, season_id,
--     currency, created_at) can never change after insert.
--   * The ONLY permitted mutation is the payment_status lifecycle:
--       pending → succeeded | failed ;  succeeded → refunded
--     status_updated_at is stamped automatically on any legal transition.
-- Stripe ids (checkout session / payment intent) may be filled in later — they are
-- lifecycle bookkeeping, not financial history.

CREATE OR REPLACE FUNCTION bids_enforce_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bids is append-only: DELETE not allowed (bid %)', OLD.id
      USING ERRCODE = 'raise_exception';
  END IF;

  IF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.season_id IS DISTINCT FROM OLD.season_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'bids is append-only: immutable columns cannot change (bid %)', OLD.id
      USING ERRCODE = 'raise_exception';
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF NOT (
         (OLD.payment_status = 'pending'   AND NEW.payment_status IN ('succeeded', 'failed'))
      OR (OLD.payment_status = 'succeeded' AND NEW.payment_status = 'refunded')
    ) THEN
      RAISE EXCEPTION 'bids is append-only: illegal payment_status transition % -> % (bid %)',
        OLD.payment_status, NEW.payment_status, OLD.id
        USING ERRCODE = 'raise_exception';
    END IF;
    NEW.status_updated_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bids_append_only ON bids;

CREATE TRIGGER bids_append_only
BEFORE UPDATE OR DELETE ON bids
FOR EACH ROW EXECUTE FUNCTION bids_enforce_append_only();
