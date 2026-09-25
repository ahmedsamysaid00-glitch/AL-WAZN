/*
# Marketing System — Tables, RLS, Seed, Realtime

## New Tables
1. marketing_settings      — single-row config (commission rate, base, enabled, attribution window)
2. marketing_referrals     — referral attribution records
3. marketing_commissions   — commission records per qualifying order
4. marketing_payouts       — marketer payout history

## Extended Tables
5. platform_settings       — add marketer_email column to identify the single marketer

## Security
- marketing_settings: SELECT authenticated; INSERT/UPDATE/DELETE admin only
- marketing_referrals: SELECT marketer (own) or admin; no direct client INSERT/UPDATE/DELETE
- marketing_commissions: SELECT marketer (own) or admin; no direct client INSERT/UPDATE/DELETE
- marketing_payouts: SELECT marketer (own) or admin; no direct client INSERT/UPDATE/DELETE

## Realtime
- All four new tables added to the realtime publication
*/

-- ============================================================
-- 5. Extend platform_settings with marketer identification
-- ============================================================
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS marketer_email text NOT NULL DEFAULT 'mohamedsamysaid1@gmail.com';

-- ============================================================
-- 1. marketing_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_rate numeric NOT NULL DEFAULT 5.0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  commission_base commission_base NOT NULL DEFAULT 'platform_fee',
  attribution_enabled boolean NOT NULL DEFAULT true,
  attribution_window_days integer NOT NULL DEFAULT 30 CHECK (attribution_window_days > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE marketing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketing_settings_select" ON marketing_settings;
CREATE POLICY "marketing_settings_select" ON marketing_settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "marketing_settings_insert_admin" ON marketing_settings;
CREATE POLICY "marketing_settings_insert_admin" ON marketing_settings FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "marketing_settings_update_admin" ON marketing_settings;
CREATE POLICY "marketing_settings_update_admin" ON marketing_settings FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "marketing_settings_delete_admin" ON marketing_settings;
CREATE POLICY "marketing_settings_delete_admin" ON marketing_settings FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Seed single row
INSERT INTO marketing_settings (commission_rate, commission_base, attribution_enabled, attribution_window_days)
SELECT 5.0, 'platform_fee', true, 30
WHERE NOT EXISTS (SELECT 1 FROM marketing_settings);

-- ============================================================
-- 2. marketing_referrals
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  referral_code text NOT NULL UNIQUE,
  referred_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  status referral_status NOT NULL DEFAULT 'attributed',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  registered_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_referrals_marketer ON marketing_referrals(marketer_id);
CREATE INDEX IF NOT EXISTS idx_marketing_referrals_referred_user ON marketing_referrals(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_marketing_referrals_code ON marketing_referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_marketing_referrals_status ON marketing_referrals(status);

ALTER TABLE marketing_referrals ENABLE ROW LEVEL SECURITY;

-- Marketer can see their own referrals; admin can see all
DROP POLICY IF EXISTS "marketing_referrals_select" ON marketing_referrals;
CREATE POLICY "marketing_referrals_select" ON marketing_referrals FOR SELECT
  TO authenticated USING (
    marketer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- No direct client INSERT/UPDATE/DELETE — only via SECURITY DEFINER RPCs
DROP POLICY IF EXISTS "marketing_referrals_insert_block" ON marketing_referrals;
CREATE POLICY "marketing_referrals_insert_block" ON marketing_referrals FOR INSERT
  TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "marketing_referrals_update_block" ON marketing_referrals;
CREATE POLICY "marketing_referrals_update_block" ON marketing_referrals FOR UPDATE
  TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "marketing_referrals_delete_block" ON marketing_referrals;
CREATE POLICY "marketing_referrals_delete_block" ON marketing_referrals FOR DELETE
  TO authenticated USING (false);

-- ============================================================
-- 3. marketing_commissions
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  referred_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  referral_id uuid REFERENCES marketing_referrals(id) ON DELETE SET NULL,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  gross_order_amount numeric NOT NULL CHECK (gross_order_amount >= 0),
  platform_fee_amount numeric NOT NULL CHECK (platform_fee_amount >= 0),
  commission_base_value numeric NOT NULL CHECK (commission_base_value >= 0),
  commission_rate numeric NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 100),
  commission_amount numeric NOT NULL CHECK (commission_amount >= 0),
  commission_base_type commission_base NOT NULL,
  currency text NOT NULL DEFAULT 'EGP',
  status commission_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  paid_at timestamptz,
  paid_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  cancellation_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Unique constraint: one commission per marketer per order
CREATE UNIQUE INDEX IF NOT EXISTS uniq_commission_marketer_order
  ON marketing_commissions(marketer_id, order_id)
  WHERE status IN ('pending', 'approved', 'paid');

CREATE INDEX IF NOT EXISTS idx_marketing_commissions_marketer ON marketing_commissions(marketer_id);
CREATE INDEX IF NOT EXISTS idx_marketing_commissions_status ON marketing_commissions(status);
CREATE INDEX IF NOT EXISTS idx_marketing_commissions_order ON marketing_commissions(order_id);
CREATE INDEX IF NOT EXISTS idx_marketing_commissions_referred_user ON marketing_commissions(referred_user_id);

ALTER TABLE marketing_commissions ENABLE ROW LEVEL SECURITY;

-- Marketer can see their own commissions; admin can see all
DROP POLICY IF EXISTS "marketing_commissions_select" ON marketing_commissions;
CREATE POLICY "marketing_commissions_select" ON marketing_commissions FOR SELECT
  TO authenticated USING (
    marketer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- No direct client INSERT/UPDATE/DELETE — only via SECURITY DEFINER RPCs
DROP POLICY IF EXISTS "marketing_commissions_insert_block" ON marketing_commissions;
CREATE POLICY "marketing_commissions_insert_block" ON marketing_commissions FOR INSERT
  TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "marketing_commissions_update_block" ON marketing_commissions;
CREATE POLICY "marketing_commissions_update_block" ON marketing_commissions FOR UPDATE
  TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "marketing_commissions_delete_block" ON marketing_commissions;
CREATE POLICY "marketing_commissions_delete_block" ON marketing_commissions FOR DELETE
  TO authenticated USING (false);

-- ============================================================
-- 4. marketing_payouts
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'EGP',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  payout_method text,
  payout_reference text,
  commission_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_marketing_payouts_marketer ON marketing_payouts(marketer_id);
CREATE INDEX IF NOT EXISTS idx_marketing_payouts_status ON marketing_payouts(status);

ALTER TABLE marketing_payouts ENABLE ROW LEVEL SECURITY;

-- Marketer can see their own payouts; admin can see all
DROP POLICY IF EXISTS "marketing_payouts_select" ON marketing_payouts;
CREATE POLICY "marketing_payouts_select" ON marketing_payouts FOR SELECT
  TO authenticated USING (
    marketer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- No direct client writes
DROP POLICY IF EXISTS "marketing_payouts_insert_block" ON marketing_payouts;
CREATE POLICY "marketing_payouts_insert_block" ON marketing_payouts FOR INSERT
  TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "marketing_payouts_update_block" ON marketing_payouts;
CREATE POLICY "marketing_payouts_update_block" ON marketing_payouts FOR UPDATE
  TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "marketing_payouts_delete_block" ON marketing_payouts;
CREATE POLICY "marketing_payouts_delete_block" ON marketing_payouts FOR DELETE
  TO authenticated USING (false);

-- ============================================================
-- Realtime publication
-- ============================================================
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['marketing_settings','marketing_referrals','marketing_commissions','marketing_payouts'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'realtime' AND schemaname = 'public' AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.marketing_settings REPLICA IDENTITY FULL;
ALTER TABLE public.marketing_referrals REPLICA IDENTITY FULL;
ALTER TABLE public.marketing_commissions REPLICA IDENTITY FULL;
ALTER TABLE public.marketing_payouts REPLICA IDENTITY FULL;
