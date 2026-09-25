-- Phase 8: Financial System completeness and idempotency hardening
--
-- This migration adds the missing RPCs needed to complete the payment
-- and refund lifecycle, fixes idempotency race conditions on existing
-- RPCs, and adds a database-level constraint to prevent duplicate
-- active payments per order.

-- =============================================================================
-- 1. Unique partial index: one active payment per order
-- =============================================================================
-- Prevents race condition in initiate_payment where two concurrent calls
-- could both pass the COUNT check and insert duplicate active payments.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_active_per_order
  ON payments (order_id)
  WHERE status NOT IN ('failed', 'cancelled');

-- =============================================================================
-- 2. Fix approve_refund idempotency (atomic UPDATE with status guard)
-- =============================================================================
CREATE OR REPLACE FUNCTION approve_refund(p_refund_id uuid)
RETURNS refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refund refunds%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve refunds';
  END IF;

  -- Atomic UPDATE with status guard prevents double-approval race
  UPDATE refunds
    SET status = 'approved', approved_by = auth.uid()
    WHERE id = p_refund_id AND status = 'requested'
    RETURNING * INTO v_refund;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund not found or not in requested status';
  END IF;

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (auth.uid(), v_refund.requested_by, 'refund_approved', 'refund', p_refund_id, v_refund.reason);

  RETURN v_refund;
END;
$$;

-- =============================================================================
-- 3. Fix process_refund idempotency + update payment status
-- =============================================================================
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

-- =============================================================================
-- 4. New RPC: reject_refund (admin-only, requested → cancelled)
-- =============================================================================
CREATE OR REPLACE FUNCTION reject_refund(p_refund_id uuid, p_reason text)
RETURNS refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refund refunds%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can reject refunds';
  END IF;

  -- Atomic UPDATE with status guard
  UPDATE refunds
    SET status = 'cancelled'
    WHERE id = p_refund_id AND status = 'requested'
    RETURNING * INTO v_refund;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund not found or not in requested status';
  END IF;

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (auth.uid(), v_refund.requested_by, 'refund_rejected', 'refund', p_refund_id, p_reason);

  -- Notify payer that refund was rejected
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (
    v_refund.requested_by, 'payment_refund_rejected',
    'Refund Rejected',
    'Your refund request has been rejected. Reason: ' || COALESCE(p_reason, 'Not specified'),
    v_refund.order_id
  );

  RETURN v_refund;
END;
$$;

-- =============================================================================
-- 5. New RPC: complete_refund (admin-only, processing → completed)
-- =============================================================================
CREATE OR REPLACE FUNCTION complete_refund(p_refund_id uuid)
RETURNS refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refund refunds%ROWTYPE;
  v_payment payments%ROWTYPE;
  v_payer_wallet wallet_accounts%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can complete refunds';
  END IF;

  -- Atomic UPDATE with status guard
  UPDATE refunds
    SET status = 'completed'
    WHERE id = p_refund_id AND status = 'processing'
    RETURNING * INTO v_refund;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund not found or not in processing status';
  END IF;

  SELECT * INTO v_payment FROM payments WHERE id = v_refund.payment_id;

  -- Credit payer's wallet with refund amount
  INSERT INTO wallet_accounts (user_id, currency, available_balance, pending_balance)
    VALUES (v_payment.payer_id, v_payment.currency, v_refund.amount, 0)
    ON CONFLICT (user_id, currency)
    DO UPDATE SET available_balance = wallet_accounts.available_balance + v_refund.amount
    RETURNING * INTO v_payer_wallet;

  -- Create ledger entry for wallet credit
  INSERT INTO financial_ledger_entries (payment_id, order_id, user_id, entry_type, direction, amount, currency, description)
  VALUES (v_payment.id, v_refund.order_id, v_payment.payer_id, 'refund', 'credit', v_refund.amount, v_payment.currency, 'Refund completed - wallet credited');

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (auth.uid(), v_refund.requested_by, 'refund_completed', 'refund', p_refund_id, 'Refund completed and wallet credited');

  -- Notify payer
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (
    v_payment.payer_id, 'payment_refunded',
    'Refund Completed',
    'Your refund of ' || v_refund.amount || ' ' || v_payment.currency || ' has been completed and credited to your wallet.',
    v_payment.order_id
  );

  RETURN v_refund;
END;
$$;

-- =============================================================================
-- 6. New RPC: complete_payment (admin-only, pending/processing → paid)
-- =============================================================================
CREATE OR REPLACE FUNCTION complete_payment(p_payment_id uuid)
RETURNS payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_payee_wallet wallet_accounts%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can complete payments';
  END IF;

  -- Atomic UPDATE with status guard prevents double-completion
  UPDATE payments
    SET status = 'paid', paid_at = now()
    WHERE id = p_payment_id AND status IN ('pending', 'processing')
    RETURNING * INTO v_payment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found or not in a completable status';
  END IF;

  -- Credit payee's wallet with net_amount
  INSERT INTO wallet_accounts (user_id, currency, available_balance, pending_balance)
    VALUES (v_payment.payee_id, v_payment.currency, v_payment.net_amount, 0)
    ON CONFLICT (user_id, currency)
    DO UPDATE SET available_balance = wallet_accounts.available_balance + v_payment.net_amount
    RETURNING * INTO v_payee_wallet;

  -- Create ledger entry for wallet credit
  INSERT INTO financial_ledger_entries (payment_id, order_id, user_id, entry_type, direction, amount, currency, description)
  VALUES (v_payment.id, v_payment.order_id, v_payment.payee_id, 'payment', 'credit', v_payment.net_amount, v_payment.currency, 'Payment completed - wallet credited');

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (auth.uid(), v_payment.payee_id, 'payment_completed', 'payment', p_payment_id, 'Payment marked as paid and wallet credited');

  -- Notify payer
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (
    v_payment.payer_id, 'payment_completed',
    'Payment Completed',
    'Your payment of ' || v_payment.amount || ' ' || v_payment.currency || ' has been completed.',
    v_payment.order_id
  );

  -- Notify payee
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (
    v_payment.payee_id, 'payment_completed',
    'Payment Received',
    'A payment of ' || v_payment.net_amount || ' ' || v_payment.currency || ' has been credited to your wallet.',
    v_payment.order_id
  );

  RETURN v_payment;
END;
$$;

-- =============================================================================
-- 7. Revoke execute from anon on all financial RPCs
-- =============================================================================
REVOKE EXECUTE ON FUNCTION complete_payment(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION reject_refund(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION complete_refund(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION approve_refund(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION process_refund(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION request_refund(uuid, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION initiate_payment(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION save_fee_config(numeric, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION activate_fee_config(uuid) FROM anon;
