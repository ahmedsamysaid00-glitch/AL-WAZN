-- Phase 8: Fix double ledger entry on refund + add missing enum values
--
-- Problem 1: process_refund creates a 'refund/credit' ledger entry, and
-- complete_refund creates ANOTHER 'refund/credit' ledger entry for the same
-- refund. This double-counts the refund in the financial ledger.
-- Fix: Remove the ledger entry creation from process_refund. The ledger
-- entry should only be created when the refund is actually completed and
-- the wallet is credited (in complete_refund).
--
-- Problem 2: complete_payment and reject_refund use notification types
-- ('payment_completed', 'payment_refund_rejected') and audit actions
-- ('payment_completed', 'refund_rejected', 'refund_completed') that don't
-- exist in the database enums. This causes the RPCs to fail with a
-- foreign key violation when they try to INSERT into notifications/audit_logs.

-- ============================================================
-- 1. Add missing notification types
-- ============================================================
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE 'payment_completed'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE notification_type ADD VALUE 'payment_refund_rejected'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Add missing audit action types
-- ============================================================
DO $$ BEGIN ALTER TYPE audit_action ADD VALUE 'refund_rejected'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE audit_action ADD VALUE 'refund_completed'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE audit_action ADD VALUE 'payment_completed'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 3. Fix process_refund: remove ledger entry creation
-- The ledger entry is now only created in complete_refund when the
-- wallet is actually credited. process_refund only updates the refund
-- status, updates payment status, creates audit log, and notifies payer.
-- ============================================================
CREATE OR REPLACE FUNCTION process_refund(p_refund_id uuid)
RETURNS refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refund refunds%ROWTYPE;
  v_payment payments%ROWTYPE;
  v_total_refunded numeric;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can process refunds';
  END IF;

  -- Atomic UPDATE with status guard prevents double-processing race
  UPDATE refunds
    SET status = 'processing', processed_at = now()
    WHERE id = p_refund_id AND status = 'approved'
    RETURNING * INTO v_refund;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund not found or not in approved status';
  END IF;

  SELECT * INTO v_payment FROM payments WHERE id = v_refund.payment_id;

  -- Update payment status based on refund amount vs payment amount
  SELECT COALESCE(SUM(amount), 0) INTO v_total_refunded
    FROM refunds
    WHERE payment_id = v_refund.payment_id
      AND status IN ('processing', 'completed');

  IF v_total_refunded >= v_payment.amount THEN
    UPDATE payments SET status = 'refunded', refunded_at = now()
      WHERE id = v_refund.payment_id AND status IN ('paid', 'partially_refunded');
  ELSE
    UPDATE payments SET status = 'partially_refunded'
      WHERE id = v_refund.payment_id AND status = 'paid';
  END IF;

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (auth.uid(), v_refund.requested_by, 'refund_processed', 'refund', p_refund_id, v_refund.reason);

  -- Notify payer that refund is being processed
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (
    v_payment.payer_id, 'payment_refunded',
    'Refund Processing',
    'Your refund of ' || v_refund.amount || ' ' || v_payment.currency || ' is being processed',
    v_payment.order_id
  );

  RETURN v_refund;
END;
$$;

-- Revoke execute from anon on the updated function
REVOKE EXECUTE ON FUNCTION process_refund(uuid) FROM anon;
