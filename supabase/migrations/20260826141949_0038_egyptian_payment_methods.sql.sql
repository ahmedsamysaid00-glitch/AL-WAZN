-- Add Egyptian payment methods to the payment_method_type enum
ALTER TYPE payment_method_type ADD VALUE IF NOT EXISTS 'instapay';
ALTER TYPE payment_method_type ADD VALUE IF NOT EXISTS 'mobile_wallet';

-- Add provider_reference column to payments for storing provider-specific references
-- (e.g. wallet network, InstaPay reference, provider payment link ID)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_reference text;

-- Add provider_status column to track the provider's own status label
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_status text;

-- Add a partial unique index to prevent duplicate active payments per order
-- Only one payment in a non-terminal state per order
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_active_per_order
  ON payments (order_id)
  WHERE status IN ('pending', 'processing', 'held');

-- Add webhook_events table for idempotency
CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_access_webhook_events" ON webhook_events
  FOR ALL TO anon, authenticated USING (false);
