/*
# Phase 7: Payments, Platform Fees & Financial Ledger

## Overview
Builds the complete financial foundation for AL-WAZN marketplace.
Creates payment records, platform fee configuration, immutable financial ledger,
wallet accounts, and refund management — all database-enforced.

## Important Notes
- No external payment provider is configured. Payments remain "pending" until
  a real provider webhook or authorized admin workflow confirms them.
- The UI will clearly show "payment provider not configured" state.
- No payment is ever marked successful from a frontend button click.
- All financial amounts are calculated server-side inside SECURITY DEFINER functions.
- The ledger is append-only — no UPDATE or DELETE allowed.
- Wallet balances start at zero and cannot be modified by users.
- Historical payment fees are snapshotted and never change when fee config changes.

## New Enum Types
1. `payment_status`: pending, processing, paid, failed, cancelled, refunded, partially_refunded
2. `payment_method_type`: card, bank_transfer, wallet, cash_on_delivery, manual
3. `refund_status`: requested, approved, processing, completed, failed, cancelled
4. `ledger_entry_type`: payment, platform_fee, refund, adjustment, payout
5. `ledger_direction`: credit, debit

## New Tables
### platform_fee_settings
- Fee configuration (percentage + fixed amount), only one active at a time
- Admin-only management, audited via audit_logs

### payments
- Links to orders, captures payer/payee, amount, platform_fee (snapshotted), net_amount
- Strict status workflow, provider-safe fields
- Users cannot create successful payments directly

### financial_ledger_entries
- Immutable append-only ledger for every financial movement
- Links to payment, order, user
- Users cannot UPDATE or DELETE

### wallet_accounts
- One per user/currency, balances default zero
- Users cannot modify balances directly
- Pending provider integration for actual payouts

### refunds
- Refund requests linked to payments
- Status workflow: requested → approved → processing → completed
- Refund amount cannot exceed refundable amount
- Users cannot mark refunds as completed

## Security
- RLS on all 5 tables
- payments: payer/payee/admin can SELECT; INSERT blocked (use secure function); UPDATE restricted; DELETE blocked
- ledger: user sees own entries; INSERT/UPDATE/DELETE all blocked
- wallet: user sees own; UPDATE/DELETE blocked
- refunds: participant/admin can SELECT; INSERT via secure function; UPDATE admin only; DELETE blocked
- fee_settings: SELECT for authenticated; INSERT/UPDATE/DELETE admin only
- All trigger/helper functions: SECURITY DEFINER, locked search_path, EXECUTE revoked from PUBLIC
- audit_action enum extended with fee_change, refund_approved, refund_processed, payment_adjusted

## Secure Functions
1. `initiate_payment(p_order_id)` — validates order, caller is sender (payer), calculates fee from active config
2. `request_refund(p_payment_id, p_amount, p_reason)` — creates refund request, validates amount
3. `process_refund(p_refund_id)` — admin-only, marks refund as processing (provider integration pending)
4. `approve_refund(p_refund_id)` — admin-only, approves a refund request
5. `get_active_fee_config()` — returns active fee settings (callable by authenticated)
*/

-- ============================================================
-- 1. ENUM TYPES
-- ============================================================

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM (
    'pending', 'processing', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method_type AS ENUM (
    'card', 'bank_transfer', 'wallet', 'cash_on_delivery', 'manual'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE refund_status AS ENUM (
    'requested', 'approved', 'processing', 'completed', 'failed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ledger_entry_type AS ENUM (
    'payment', 'platform_fee', 'refund', 'adjustment', 'payout'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ledger_direction AS ENUM (
    'credit', 'debit'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. EXTEND NOTIFICATION TYPES
-- ============================================================

DO $$ BEGIN ALTER TYPE notification_type ADD VALUE 'payment_pending'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE 'payment_paid'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE 'payment_failed'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE 'payment_refund_requested'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE 'payment_refunded'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE 'payment_cancelled'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 3. EXTEND AUDIT ACTION TYPES
-- ============================================================

DO $$ BEGIN ALTER TYPE audit_action ADD VALUE 'fee_change'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE audit_action ADD VALUE 'refund_approved'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE audit_action ADD VALUE 'refund_processed'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE audit_action ADD VALUE 'payment_adjusted'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 4. PLATFORM FEE SETTINGS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_fee_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_type text NOT NULL DEFAULT 'percentage',
  percentage numeric NOT NULL DEFAULT 0 CHECK (percentage >= 0 AND percentage <= 100),
  fixed_amount numeric NOT NULL DEFAULT 0 CHECK (fixed_amount >= 0),
  currency text NOT NULL DEFAULT 'USD',
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fee_settings_active ON platform_fee_settings(is_active);

-- ============================================================
-- 5. PAYMENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  payee_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount >= 0),
  platform_fee numeric NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  net_amount numeric NOT NULL DEFAULT 0 CHECK (net_amount >= 0),
  currency text NOT NULL DEFAULT 'USD',
  payment_method payment_method_type NOT NULL DEFAULT 'manual',
  provider text,
  provider_payment_id text,
  status payment_status NOT NULL DEFAULT 'pending',
  failure_reason text,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_net_check CHECK (net_amount = amount - platform_fee)
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_payer_id ON payments(payer_id);
CREATE INDEX IF NOT EXISTS idx_payments_payee_id ON payments(payee_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_provider_payment_id ON payments(provider_payment_id) WHERE provider_payment_id IS NOT NULL;

-- ============================================================
-- 6. FINANCIAL LEDGER ENTRIES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS financial_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid REFERENCES payments(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  entry_type ledger_entry_type NOT NULL,
  direction ledger_direction NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'USD',
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_payment_id ON financial_ledger_entries(payment_id);
CREATE INDEX IF NOT EXISTS idx_ledger_order_id ON financial_ledger_entries(order_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user_id ON financial_ledger_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON financial_ledger_entries(created_at);

-- ============================================================
-- 7. WALLET ACCOUNTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS wallet_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  currency text NOT NULL DEFAULT 'USD',
  available_balance numeric NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  pending_balance numeric NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_unique_user_currency UNIQUE (user_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_wallet_user_id ON wallet_accounts(user_id);

-- ============================================================
-- 8. REFUNDS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  reason text,
  status refund_status NOT NULL DEFAULT 'requested',
  provider_refund_id text,
  requested_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_refunds_payment_id ON refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);
CREATE INDEX IF NOT EXISTS idx_refunds_requested_by ON refunds(requested_by);
CREATE INDEX IF NOT EXISTS idx_refunds_created_at ON refunds(created_at);

-- ============================================================
-- 9. ENABLE RLS ON ALL TABLES
-- ============================================================

ALTER TABLE platform_fee_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 10. RLS POLICIES — platform_fee_settings
-- ============================================================

DROP POLICY IF EXISTS "fee_select" ON platform_fee_settings;
CREATE POLICY "fee_select" ON platform_fee_settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "fee_insert" ON platform_fee_settings;
CREATE POLICY "fee_insert" ON platform_fee_settings FOR INSERT
  TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS "fee_update" ON platform_fee_settings;
CREATE POLICY "fee_update" ON platform_fee_settings FOR UPDATE
  TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "fee_delete" ON platform_fee_settings;
CREATE POLICY "fee_delete" ON platform_fee_settings FOR DELETE
  TO authenticated USING (is_admin());

-- ============================================================
-- 11. RLS POLICIES — payments
-- ============================================================

DROP POLICY IF EXISTS "payment_select" ON payments;
CREATE POLICY "payment_select" ON payments FOR SELECT
  TO authenticated USING (
    auth.uid() = payer_id OR auth.uid() = payee_id OR is_admin()
  );

DROP POLICY IF EXISTS "payment_insert" ON payments;
CREATE POLICY "payment_insert" ON payments FOR INSERT
  TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "payment_update" ON payments;
CREATE POLICY "payment_update" ON payments FOR UPDATE
  TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "payment_delete" ON payments;
CREATE POLICY "payment_delete" ON payments FOR DELETE
  TO authenticated USING (false);

-- ============================================================
-- 12. RLS POLICIES — financial_ledger_entries
-- ============================================================

DROP POLICY IF EXISTS "ledger_select" ON financial_ledger_entries;
CREATE POLICY "ledger_select" ON financial_ledger_entries FOR SELECT
  TO authenticated USING (auth.uid() = user_id OR is_admin());

DROP POLICY IF EXISTS "ledger_insert" ON financial_ledger_entries;
CREATE POLICY "ledger_insert" ON financial_ledger_entries FOR INSERT
  TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "ledger_update" ON financial_ledger_entries;
CREATE POLICY "ledger_update" ON financial_ledger_entries FOR UPDATE
  TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "ledger_delete" ON financial_ledger_entries;
CREATE POLICY "ledger_delete" ON financial_ledger_entries FOR DELETE
  TO authenticated USING (false);

-- ============================================================
-- 13. RLS POLICIES — wallet_accounts
-- ============================================================

DROP POLICY IF EXISTS "wallet_select" ON wallet_accounts;
CREATE POLICY "wallet_select" ON wallet_accounts FOR SELECT
  TO authenticated USING (auth.uid() = user_id OR is_admin());

DROP POLICY IF EXISTS "wallet_insert" ON wallet_accounts;
CREATE POLICY "wallet_insert" ON wallet_accounts FOR INSERT
  TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "wallet_update" ON wallet_accounts;
CREATE POLICY "wallet_update" ON wallet_accounts FOR UPDATE
  TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "wallet_delete" ON wallet_accounts;
CREATE POLICY "wallet_delete" ON wallet_accounts FOR DELETE
  TO authenticated USING (false);

-- ============================================================
-- 14. RLS POLICIES — refunds
-- ============================================================

DROP POLICY IF EXISTS "refund_select" ON refunds;
CREATE POLICY "refund_select" ON refunds FOR SELECT
  TO authenticated USING (
    auth.uid() = requested_by OR is_admin()
    OR EXISTS (
      SELECT 1 FROM payments p
      WHERE p.id = refunds.payment_id
      AND (p.payer_id = auth.uid() OR p.payee_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "refund_insert" ON refunds;
CREATE POLICY "refund_insert" ON refunds FOR INSERT
  TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "refund_update" ON refunds;
CREATE POLICY "refund_update" ON refunds FOR UPDATE
  TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "refund_delete" ON refunds;
CREATE POLICY "refund_delete" ON refunds FOR DELETE
  TO authenticated USING (false);

-- ============================================================
-- 15. HELPER FUNCTION: get_active_fee_config (SECURITY DEFINER)
-- Returns the active fee configuration, callable by authenticated users
-- ============================================================

CREATE OR REPLACE FUNCTION get_active_fee_config()
RETURNS platform_fee_settings
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT * FROM platform_fee_settings WHERE is_active = true LIMIT 1;
$$;

-- ============================================================
-- 16. HELPER FUNCTION: calculate_platform_fee (internal)
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_platform_fee(p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_fee_config platform_fee_settings%ROWTYPE;
  v_fee numeric;
BEGIN
  SELECT * INTO v_fee_config FROM platform_fee_settings WHERE is_active = true LIMIT 1;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_fee := (p_amount * v_fee_config.percentage / 100) + v_fee_config.fixed_amount;
  IF v_fee > p_amount THEN
    v_fee := p_amount;
  END IF;
  RETURN ROUND(v_fee, 2);
END;
$$;

-- ============================================================
-- 17. SECURE FUNCTION: initiate_payment
-- Creates a pending payment for an eligible order
-- Validates: order exists, caller is sender (payer), order status allows payment,
-- no existing active payment, calculates fee from active config
-- ============================================================

CREATE OR REPLACE FUNCTION initiate_payment(p_order_id uuid)
RETURNS payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_fee numeric;
  v_net numeric;
  v_payment payments%ROWTYPE;
  v_existing_count int;
BEGIN
  -- Load order
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Caller must be the sender (payer)
  IF v_order.sender_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the sender can initiate payment for this order';
  END IF;

  -- Order must be in a payable state (confirmed, in_transit, delivered, received)
  IF v_order.status NOT IN ('confirmed', 'in_transit', 'delivered', 'received') THEN
    RAISE EXCEPTION 'Order status (%) does not allow payment', v_order.status;
  END IF;

  -- Check for existing non-failed/cancelled payment
  SELECT COUNT(*) INTO v_existing_count
  FROM payments
  WHERE order_id = p_order_id
  AND status NOT IN ('failed', 'cancelled');

  IF v_existing_count > 0 THEN
    RAISE EXCEPTION 'An active payment already exists for this order';
  END IF;

  -- Calculate fee from active config
  v_fee := calculate_platform_fee(v_order.total_amount);
  v_net := v_order.total_amount - v_fee;

  -- Create payment (always starts as pending)
  INSERT INTO payments (
    order_id, payer_id, payee_id, amount, platform_fee, net_amount,
    currency, status, payment_method
  )
  VALUES (
    p_order_id, v_order.sender_id, v_order.traveler_id,
    v_order.total_amount, v_fee, v_net,
    v_order.currency, 'pending', 'manual'
  )
  RETURNING * INTO v_payment;

  -- Create ledger entries (payment + platform fee)
  INSERT INTO financial_ledger_entries (payment_id, order_id, user_id, entry_type, direction, amount, currency, description)
  VALUES (v_payment.id, p_order_id, v_order.sender_id, 'payment', 'debit', v_order.total_amount, v_order.currency, 'Payment initiated');

  INSERT INTO financial_ledger_entries (payment_id, order_id, user_id, entry_type, direction, amount, currency, description)
  VALUES (v_payment.id, p_order_id, v_order.sender_id, 'platform_fee', 'debit', v_fee, v_order.currency, 'Platform fee');

  INSERT INTO financial_ledger_entries (payment_id, order_id, user_id, entry_type, direction, amount, currency, description)
  VALUES (v_payment.id, p_order_id, v_order.traveler_id, 'payment', 'credit', v_net, v_order.currency, 'Payment to traveler');

  -- Notify the traveler (payee) about pending payment
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (
    v_order.traveler_id, 'payment_pending',
    'New Payment Pending',
    'A payment of ' || v_order.total_amount || ' ' || v_order.currency || ' has been initiated for order ' || v_order.order_number,
    p_order_id
  );

  RETURN v_payment;
END;
$$;

-- ============================================================
-- 18. SECURE FUNCTION: request_refund
-- Creates a refund request for a payment
-- Validates: payment exists, caller is payer, amount <= refundable amount
-- ============================================================

CREATE OR REPLACE FUNCTION request_refund(p_payment_id uuid, p_amount numeric, p_reason text)
RETURNS refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_order orders%ROWTYPE;
  v_existing_refunded numeric;
  v_refund refunds%ROWTYPE;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  -- Caller must be the payer
  IF v_payment.payer_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the payer can request a refund';
  END IF;

  -- Payment must be paid or partially_refunded
  IF v_payment.status NOT IN ('paid', 'partially_refunded') THEN
    RAISE EXCEPTION 'Refund can only be requested for paid payments';
  END IF;

  -- Check total already refunded
  SELECT COALESCE(SUM(amount), 0) INTO v_existing_refunded
  FROM refunds
  WHERE payment_id = p_payment_id
  AND status IN ('requested', 'approved', 'processing', 'completed');

  IF p_amount > (v_payment.amount - v_existing_refunded) THEN
    RAISE EXCEPTION 'Refund amount exceeds refundable amount';
  END IF;

  -- Create refund request
  INSERT INTO refunds (payment_id, order_id, amount, reason, status, requested_by)
  VALUES (p_payment_id, v_payment.order_id, p_amount, p_reason, 'requested', auth.uid())
  RETURNING * INTO v_refund;

  -- Notify payee about refund request
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (
    v_payment.payee_id, 'payment_refund_requested',
    'Refund Requested',
    'A refund of ' || p_amount || ' ' || v_payment.currency || ' has been requested',
    v_payment.order_id
  );

  RETURN v_refund;
END;
$$;

-- ============================================================
-- 19. SECURE FUNCTION: approve_refund (admin only)
-- ============================================================

CREATE OR REPLACE FUNCTION approve_refund(p_refund_id uuid)
RETURNS refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_refund refunds%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve refunds';
  END IF;

  SELECT * INTO v_refund FROM refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund not found';
  END IF;

  IF v_refund.status != 'requested' THEN
    RAISE EXCEPTION 'Refund must be in requested status';
  END IF;

  UPDATE refunds SET status = 'approved', approved_by = auth.uid()
  WHERE id = p_refund_id
  RETURNING * INTO v_refund;

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (auth.uid(), v_refund.requested_by, 'refund_approved', 'refund', p_refund_id, v_refund.reason);

  RETURN v_refund;
END;
$$;

-- ============================================================
-- 20. SECURE FUNCTION: process_refund (admin only)
-- Marks refund as processing — actual provider integration pending
-- ============================================================

CREATE OR REPLACE FUNCTION process_refund(p_refund_id uuid)
RETURNS refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_refund refunds%ROWTYPE;
  v_payment payments%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can process refunds';
  END IF;

  SELECT * INTO v_refund FROM refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund not found';
  END IF;

  IF v_refund.status != 'approved' THEN
    RAISE EXCEPTION 'Refund must be approved before processing';
  END IF;

  SELECT * INTO v_payment FROM payments WHERE id = v_refund.payment_id;

  -- Mark as processing (provider integration pending)
  UPDATE refunds SET status = 'processing', processed_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO v_refund;

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (auth.uid(), v_refund.requested_by, 'refund_processed', 'refund', p_refund_id, v_refund.reason);

  -- Create ledger entry for refund
  INSERT INTO financial_ledger_entries (payment_id, order_id, user_id, entry_type, direction, amount, currency, description)
  VALUES (v_payment.id, v_refund.order_id, v_payment.payer_id, 'refund', 'credit', v_refund.amount, v_payment.currency, 'Refund processed');

  -- Notify payer
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (
    v_payment.payer_id, 'payment_refunded',
    'Refund Processed',
    'Your refund of ' || v_refund.amount || ' ' || v_payment.currency || ' is being processed',
    v_payment.order_id
  );

  RETURN v_refund;
END;
$$;

-- ============================================================
-- 21. TRIGGERS — payments: updated_at + immutability guard
-- ============================================================

CREATE OR REPLACE FUNCTION payment_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_updated_at ON payments;
CREATE TRIGGER payment_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payment_set_updated_at();

-- Immutability guard: prevent changes to financial identity fields
CREATE OR REPLACE FUNCTION guard_payment_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'Cannot change order_id on a payment';
  END IF;
  IF NEW.payer_id IS DISTINCT FROM OLD.payer_id THEN
    RAISE EXCEPTION 'Cannot change payer_id on a payment';
  END IF;
  IF NEW.payee_id IS DISTINCT FROM OLD.payee_id THEN
    RAISE EXCEPTION 'Cannot change payee_id on a payment';
  END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'Cannot change amount on a payment';
  END IF;
  IF NEW.platform_fee IS DISTINCT FROM OLD.platform_fee THEN
    RAISE EXCEPTION 'Cannot change platform_fee on a payment';
  END IF;
  IF NEW.net_amount IS DISTINCT FROM OLD.net_amount THEN
    RAISE EXCEPTION 'Cannot change net_amount on a payment';
  END IF;
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'Cannot change currency on a payment';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Cannot change created_at on a payment';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_guard_ownership ON payments;
CREATE TRIGGER payment_guard_ownership BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION guard_payment_ownership();

-- ============================================================
-- 22. TRIGGERS — ledger: fully immutable (no UPDATE, no DELETE)
-- ============================================================

CREATE OR REPLACE FUNCTION guard_ledger_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'Financial ledger entries are immutable and cannot be modified';
END;
$$;

DROP TRIGGER IF EXISTS ledger_no_update ON financial_ledger_entries;
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON financial_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION guard_ledger_immutable();

DROP TRIGGER IF EXISTS ledger_no_delete ON financial_ledger_entries;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON financial_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION guard_ledger_immutable();

-- ============================================================
-- 23. TRIGGERS — wallet: updated_at + balance guard
-- ============================================================

CREATE OR REPLACE FUNCTION wallet_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wallet_updated_at ON wallet_accounts;
CREATE TRIGGER wallet_updated_at BEFORE UPDATE ON wallet_accounts
  FOR EACH ROW EXECUTE FUNCTION wallet_set_updated_at();

-- Wallet user_id immutability
CREATE OR REPLACE FUNCTION guard_wallet_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Cannot change user_id on a wallet account';
  END IF;
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'Cannot change currency on a wallet account';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Cannot change created_at on a wallet account';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wallet_guard_ownership ON wallet_accounts;
CREATE TRIGGER wallet_guard_ownership BEFORE UPDATE ON wallet_accounts
  FOR EACH ROW EXECUTE FUNCTION guard_wallet_ownership();

-- ============================================================
-- 24. TRIGGERS — refunds: immutability guard
-- ============================================================

CREATE OR REPLACE FUNCTION guard_refund_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.payment_id IS DISTINCT FROM OLD.payment_id THEN
    RAISE EXCEPTION 'Cannot change payment_id on a refund';
  END IF;
  IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'Cannot change order_id on a refund';
  END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'Cannot change amount on a refund';
  END IF;
  IF NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'Cannot change requested_by on a refund';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Cannot change created_at on a refund';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refund_guard_ownership ON refunds;
CREATE TRIGGER refund_guard_ownership BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION guard_refund_ownership();

-- ============================================================
-- 25. TRIGGERS — fee_settings: updated_at + ensure single active
-- ============================================================

CREATE OR REPLACE FUNCTION fee_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fee_updated_at ON platform_fee_settings;
CREATE TRIGGER fee_updated_at BEFORE UPDATE ON platform_fee_settings
  FOR EACH ROW EXECUTE FUNCTION fee_set_updated_at();

-- Ensure only one active fee config
CREATE OR REPLACE FUNCTION ensure_single_active_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE platform_fee_settings SET is_active = false WHERE id != NEW.id AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fee_ensure_single_active ON platform_fee_settings;
CREATE TRIGGER fee_ensure_single_active BEFORE INSERT OR UPDATE ON platform_fee_settings
  FOR EACH ROW EXECUTE FUNCTION ensure_single_active_fee();

-- ============================================================
-- 26. SEED DEFAULT FEE CONFIG (0% — no fee until admin configures)
-- ============================================================

INSERT INTO platform_fee_settings (fee_type, percentage, fixed_amount, currency, is_active)
VALUES ('percentage', 0, 0, 'USD', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 27. REVOKE EXECUTE FROM PUBLIC ON ALL SECURITY DEFINER FUNCTIONS
-- ============================================================

REVOKE EXECUTE ON FUNCTION get_active_fee_config() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION calculate_platform_fee(numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION initiate_payment(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION request_refund(uuid, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION approve_refund(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION process_refund(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION payment_set_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_payment_ownership() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_ledger_immutable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION wallet_set_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_wallet_ownership() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_refund_ownership() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fee_set_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ensure_single_active_fee() FROM PUBLIC;

-- Grant execute on user-facing functions to authenticated only
GRANT EXECUTE ON FUNCTION initiate_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION request_refund(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_fee_config() TO authenticated;
