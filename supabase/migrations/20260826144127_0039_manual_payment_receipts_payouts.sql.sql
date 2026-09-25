/*
# Manual Payment + Receipt Verification + Traveler Payout System

## Summary
Adds database infrastructure for manual payment with receipt upload, admin verification, and traveler payout management.

## New Tables
- `payment_receipts`: Stores uploaded payment receipt files with verification status
- `payouts`: Stores traveler payout requests with processing status

## New Enums
- `receipt_status`: pending_verification, approved, rejected
- `payout_method_type`: vodafone_cash, orange_cash, etisalat_cash, we_pay, instapay, bank_transfer
- `payout_status`: pending, approved, processing, completed, rejected

## New Audit Actions
- receipt_uploaded, receipt_approved, receipt_rejected
- payout_submitted, payout_approved, payout_rejected, payout_completed

## New Notification Types
- payment_receipt_uploaded, payment_receipt_approved, payment_receipt_rejected
- payout_requested, payout_approved, payout_completed, payout_rejected

## Security
- RLS enabled on both new tables
- payment_receipts: senders can read/insert their own; admins can read all and update status
- payouts: travelers can read/insert their own; admins can read all and update status
- Storage bucket `payment-receipts` created as private bucket with folder-based access control
*/

-- ============================================================
-- New Enums
-- ============================================================

DO $$ BEGIN
  CREATE TYPE receipt_status AS ENUM ('pending_verification', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payout_method_type AS ENUM (
    'vodafone_cash', 'orange_cash', 'etisalat_cash', 'we_pay', 'instapay', 'bank_transfer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payout_status AS ENUM ('pending', 'approved', 'processing', 'completed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- New Audit Actions
-- ============================================================

DO $$ BEGIN ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'receipt_uploaded'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'receipt_approved'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'receipt_rejected'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payout_submitted'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payout_approved'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payout_rejected'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payout_completed'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- New Notification Types
-- ============================================================

DO $$ BEGIN ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_receipt_uploaded'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_receipt_approved'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_receipt_rejected'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payout_requested'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payout_approved'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payout_completed'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payout_rejected'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- payment_receipts table
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  uploader_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_type text,
  file_size bigint,
  status receipt_status NOT NULL DEFAULT 'pending_verification',
  rejection_reason text,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_payment_id ON payment_receipts(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_order_id ON payment_receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_status ON payment_receipts(status);

ALTER TABLE payment_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_receipts" ON payment_receipts;
CREATE POLICY "select_own_receipts" ON payment_receipts FOR SELECT
  TO authenticated USING (
    uploader_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "insert_own_receipts" ON payment_receipts;
CREATE POLICY "insert_own_receipts" ON payment_receipts FOR INSERT
  TO authenticated WITH CHECK (uploader_id = auth.uid());

DROP POLICY IF EXISTS "update_receipts_admin_only" ON payment_receipts;
CREATE POLICY "update_receipts_admin_only" ON payment_receipts FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================================
-- payouts table
-- ============================================================

CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  traveler_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  payout_method payout_method_type NOT NULL,
  payout_identifier text NOT NULL,
  payout_details jsonb,
  gross_amount numeric NOT NULL,
  platform_fee numeric NOT NULL,
  net_amount numeric NOT NULL,
  currency text NOT NULL,
  status payout_status NOT NULL DEFAULT 'pending',
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  rejection_reason text,
  rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payouts_order_id ON payouts(order_id);
CREATE INDEX IF NOT EXISTS idx_payouts_traveler_id ON payouts(traveler_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_one_active_per_order ON payouts(order_id)
  WHERE status IN ('pending', 'approved', 'processing');

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_payouts" ON payouts;
CREATE POLICY "select_own_payouts" ON payouts FOR SELECT
  TO authenticated USING (
    traveler_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "insert_own_payouts" ON payouts;
CREATE POLICY "insert_own_payouts" ON payouts FOR INSERT
  TO authenticated WITH CHECK (traveler_id = auth.uid());

DROP POLICY IF EXISTS "update_payouts_admin_only" ON payouts;
CREATE POLICY "update_payouts_admin_only" ON payouts FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================================
-- Storage bucket for payment receipts (private)
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-receipts', 'payment-receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: senders can upload to their own folder, admins can read all
-- Uses path_tokens[1] for the user-id folder prefix
DROP POLICY IF EXISTS "receipts_upload_own" ON storage.objects;
CREATE POLICY "receipts_upload_own" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'payment-receipts'
    AND path_tokens[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "receipts_read_own_or_admin" ON storage.objects;
CREATE POLICY "receipts_read_own_or_admin" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'payment-receipts'
    AND (
      path_tokens[1] = auth.uid()::text
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    )
  );

-- ============================================================
-- updated_at triggers
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_receipts_updated ON payment_receipts;
CREATE TRIGGER trg_payment_receipts_updated BEFORE UPDATE ON payment_receipts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_payouts_updated ON payouts;
CREATE TRIGGER trg_payouts_updated BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Enable realtime on new tables
-- ============================================================

ALTER TABLE payment_receipts REPLICA IDENTITY FULL;
ALTER TABLE payouts REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE payment_receipts;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE payouts;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
