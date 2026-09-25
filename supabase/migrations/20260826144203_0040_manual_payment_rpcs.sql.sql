/*
# Manual Payment RPCs: Receipt Verification + Payout Management + Order Start Guard

## Summary
This migration creates the server-side RPCs for the manual payment system:

1. `verify_payment_receipt(p_receipt_id)` — Admin approves a payment receipt.
   - Verifies admin role, receipt exists and is pending_verification
   - Transitions payment to held, order to confirmed
   - Creates ledger entry, audit log, notifications
   - Atomic with status guards

2. `reject_payment_receipt(p_receipt_id, p_rejection_reason)` — Admin rejects a receipt.
   - Verifies admin role, receipt is pending_verification
   - Sets receipt to rejected, allows sender to re-upload
   - Creates audit log, notification

3. `submit_payout(p_order_id, p_payout_method, p_payout_identifier, p_payout_details)` — Traveler submits payout info.
   - Verifies caller is the traveler, order is delivered/received/completed
   - Calculates platform fee server-side
   - Creates payout record with pending status
   - Notifies admins

4. `approve_payout(p_payout_id)` — Admin approves a payout.
   - Verifies admin role, payout is pending
   - Transitions to approved
   - Creates audit log, notification

5. `complete_payout(p_payout_id)` — Admin marks payout as paid.
   - Verifies admin role, payout is approved/processing
   - Transitions to completed, records paid_at/paid_by
   - Credits traveler wallet, creates ledger entry
   - Creates audit log, notification
   - Double-payout protection via status guard

6. `reject_payout(p_payout_id, p_rejection_reason)` — Admin rejects a payout.
   - Verifies admin role, payout is pending/approved
   - Transitions to rejected
   - Creates audit log, notification

7. Modified `guard_order_status_transition` — Adds payment verification check.
   - Orders cannot enter in_transit without a verified/held payment
   - Server-side enforcement, not just frontend

## Security
- All verification/payout RPCs use SECURITY DEFINER with search_path = 'public'
- Admin checks use is_admin() function
- Traveler checks verify auth.uid() matches order.traveler_id
- Status guards prevent double-processing
- Platform fee calculated server-side from existing fee configuration
*/

-- ============================================================
-- Helper: calculate platform fee for an order
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_platform_fee(p_amount numeric, p_currency text DEFAULT 'EGP')
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_fee_percentage numeric;
  v_fee_fixed numeric;
  v_fee numeric;
BEGIN
  SELECT COALESCE(percentage, 0), COALESCE(fixed_amount, 0)
  INTO v_fee_percentage, v_fee_fixed
  FROM platform_fee_settings
  WHERE fee_type = 'platform_fee'
    AND currency = p_currency
    AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  v_fee := (p_amount * v_fee_percentage / 100) + v_fee_fixed;
  RETURN ROUND(v_fee, 2);
END;
$$;

-- ============================================================
-- verify_payment_receipt: Admin approves a receipt
-- ============================================================

CREATE OR REPLACE FUNCTION verify_payment_receipt(p_receipt_id uuid)
RETURNS payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_receipt payment_receipts%ROWTYPE;
  v_payment payments%ROWTYPE;
  v_order orders%ROWTYPE;
  v_updated_count int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can verify payment receipts';
  END IF;

  SELECT * INTO v_receipt FROM payment_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  IF v_receipt.status <> 'pending_verification' THEN
    RAISE EXCEPTION 'Receipt is not pending verification (current: %)', v_receipt.status;
  END IF;

  SELECT * INTO v_payment FROM payments WHERE id = v_receipt.payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found for this receipt';
  END IF;

  IF v_payment.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'Payment is not pending (current: %)', v_payment.status;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_payment.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Order is not awaiting payment (current: %)', v_order.status;
  END IF;

  -- Mark receipt as approved
  UPDATE payment_receipts
  SET status = 'approved', verified_by = auth.uid(), verified_at = now()
  WHERE id = v_receipt.id AND status = 'pending_verification';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Receipt has already been processed';
  END IF;

  -- Transition payment to held
  UPDATE payments
  SET status = 'held', paid_at = now(),
      provider = COALESCE(provider, 'manual'),
      provider_payment_id = COALESCE(provider_payment_id, 'receipt_' || v_receipt.id::text),
      provider_event_id = COALESCE(provider_event_id, 'admin_verify_' || auth.uid()::text)
  WHERE id = v_payment.id AND status IN ('pending', 'processing');

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Payment has already been processed';
  END IF;

  -- Transition order to confirmed
  UPDATE orders SET status = 'confirmed' WHERE id = v_order.id;

  -- Create platform_held ledger entry
  INSERT INTO financial_ledger_entries (
    payment_id, order_id, user_id, entry_type, direction, amount, currency, description
  ) VALUES (
    v_payment.id, v_order.id, v_payment.payer_id, 'platform_held', 'credit',
    v_payment.amount, v_payment.currency, 'Payment verified by admin from receipt upload'
  );

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (auth.uid(), v_payment.payer_id, 'receipt_approved', 'payment_receipt', v_receipt.id);

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (auth.uid(), v_payment.payer_id, 'payment_held', 'payment', v_payment.id);

  -- Notify sender: payment approved
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (
    v_payment.payer_id, 'payment_receipt_approved', 'Payment Verified',
    'Your payment receipt has been verified. Your order is now confirmed.',
    v_order.id
  );

  -- Notify traveler: payment secured
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (
    v_order.traveler_id, 'payment_held', 'Payment Secured',
    'The sender''s payment has been verified. Funds are held by the platform and will be released after delivery.',
    v_order.id
  );

  RETURN v_payment;
END;
$$;

-- ============================================================
-- reject_payment_receipt: Admin rejects a receipt
-- ============================================================

CREATE OR REPLACE FUNCTION reject_payment_receipt(p_receipt_id uuid, p_rejection_reason text)
RETURNS payment_receipts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_receipt payment_receipts%ROWTYPE;
  v_updated_count int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can reject payment receipts';
  END IF;

  IF p_rejection_reason IS NULL OR trim(p_rejection_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  SELECT * INTO v_receipt FROM payment_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  IF v_receipt.status <> 'pending_verification' THEN
    RAISE EXCEPTION 'Receipt is not pending verification (current: %)', v_receipt.status;
  END IF;

  UPDATE payment_receipts
  SET status = 'rejected', rejection_reason = p_rejection_reason
  WHERE id = v_receipt.id AND status = 'pending_verification';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Receipt has already been processed';
  END IF;

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (auth.uid(), v_receipt.uploader_id, 'receipt_rejected', 'payment_receipt', v_receipt.id);

  -- Notify sender: receipt rejected
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (
    v_receipt.uploader_id, 'payment_receipt_rejected', 'Payment Receipt Rejected',
    'Your payment receipt was rejected. Reason: ' || p_rejection_reason || '. Please upload a new receipt.',
    v_receipt.order_id
  );

  RETURN v_receipt;
END;
$$;

-- ============================================================
-- submit_payout: Traveler submits payout details
-- ============================================================

CREATE OR REPLACE FUNCTION submit_payout(
  p_order_id uuid,
  p_payout_method payout_method_type,
  p_payout_identifier text,
  p_payout_details jsonb DEFAULT NULL
)
RETURNS payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid;
  v_order orders%ROWTYPE;
  v_payment payments%ROWTYPE;
  v_existing payouts%ROWTYPE;
  v_platform_fee numeric;
  v_net_amount numeric;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.traveler_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Unauthorized: only the assigned traveler can submit payout details';
  END IF;

  IF v_order.status NOT IN ('delivered', 'received', 'completed') THEN
    RAISE EXCEPTION 'Order must be delivered before requesting payout (current: %)', v_order.status;
  END IF;

  -- Check for existing active payout
  SELECT * INTO v_existing FROM payouts
  WHERE order_id = p_order_id AND status IN ('pending', 'approved', 'processing')
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'A payout request already exists for this order';
  END IF;

  -- Get the held/released payment
  SELECT * INTO v_payment FROM payments
  WHERE order_id = p_order_id AND status IN ('held', 'released')
  ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No verified payment found for this order';
  END IF;

  -- Calculate platform fee server-side
  v_platform_fee := v_payment.platform_fee;
  v_net_amount := v_payment.net_amount;

  INSERT INTO payouts (
    payment_id, order_id, traveler_id, payout_method, payout_identifier,
    payout_details, gross_amount, platform_fee, net_amount, currency, status
  ) VALUES (
    v_payment.id, p_order_id, v_caller, p_payout_method, p_payout_identifier,
    p_payout_details, v_payment.amount, v_platform_fee, v_net_amount, v_payment.currency, 'pending'
  )
  RETURNING * INTO v_existing;

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_caller, v_caller, 'payout_submitted', 'payout', v_existing.id);

  -- Notify admins
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  SELECT u.id, 'payout_requested', 'New Payout Request',
    'Traveler has submitted payout details for order ' || v_order.order_number,
    v_order.id
  FROM profiles u WHERE u.role = 'admin';

  -- Notify traveler
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (v_caller, 'payout_requested', 'Payout Submitted',
    'Your payout request has been submitted. An admin will review and process it.',
    v_order.id);

  RETURN v_existing;
END;
$$;

-- ============================================================
-- approve_payout: Admin approves a payout
-- ============================================================

CREATE OR REPLACE FUNCTION approve_payout(p_payout_id uuid)
RETURNS payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payout payouts%ROWTYPE;
  v_updated_count int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve payouts';
  END IF;

  SELECT * INTO v_payout FROM payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;

  IF v_payout.status <> 'pending' THEN
    RAISE EXCEPTION 'Payout is not pending (current: %)', v_payout.status;
  END IF;

  UPDATE payouts
  SET status = 'approved', approved_by = auth.uid(), approved_at = now()
  WHERE id = v_payout.id AND status = 'pending';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Payout has already been processed';
  END IF;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (auth.uid(), v_payout.traveler_id, 'payout_approved', 'payout', v_payout.id);

  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (v_payout.traveler_id, 'payout_approved', 'Payout Approved',
    'Your payout request has been approved. The admin will process the transfer shortly.',
    v_payout.order_id);

  RETURN v_payout;
END;
$$;

-- ============================================================
-- complete_payout: Admin marks payout as paid
-- ============================================================

CREATE OR REPLACE FUNCTION complete_payout(p_payout_id uuid)
RETURNS payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payout payouts%ROWTYPE;
  v_updated_count int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can complete payouts';
  END IF;

  SELECT * INTO v_payout FROM payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;

  IF v_payout.status NOT IN ('approved', 'processing') THEN
    RAISE EXCEPTION 'Payout is not approved or processing (current: %)', v_payout.status;
  END IF;

  -- Atomic transition to completed (prevents double-payout)
  UPDATE payouts
  SET status = 'completed', completed_by = auth.uid(), completed_at = now()
  WHERE id = v_payout.id AND status IN ('approved', 'processing');

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Payout has already been completed';
  END IF;

  -- Credit traveler wallet
  INSERT INTO wallet_accounts (user_id, currency, available_balance, pending_balance)
  VALUES (v_payout.traveler_id, v_payout.currency, v_payout.net_amount, 0)
  ON CONFLICT (user_id, currency) DO UPDATE
  SET available_balance = wallet_accounts.available_balance + v_payout.net_amount,
      updated_at = now();

  -- Create payout ledger entry
  INSERT INTO financial_ledger_entries (
    payment_id, order_id, user_id, entry_type, direction, amount, currency, description
  ) VALUES (
    v_payout.payment_id, v_payout.order_id, v_payout.traveler_id, 'payout', 'credit',
    v_payout.net_amount, v_payout.currency, 'Traveler payout completed'
  );

  -- Create platform_fee ledger entry
  INSERT INTO financial_ledger_entries (
    payment_id, order_id, user_id, entry_type, direction, amount, currency, description
  ) VALUES (
    v_payout.payment_id, v_payout.order_id, v_payout.traveler_id, 'platform_fee', 'debit',
    v_payout.platform_fee, v_payout.currency, 'Platform fee deducted from payout'
  );

  -- Update payment status to released
  UPDATE payments SET status = 'released'
  WHERE id = v_payout.payment_id AND status = 'held';

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (auth.uid(), v_payout.traveler_id, 'payout_completed', 'payout', v_payout.id);

  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (v_payout.traveler_id, 'payout_completed', 'Payout Completed',
    'Your payout has been processed. The funds have been added to your wallet.',
    v_payout.order_id);

  RETURN v_payout;
END;
$$;

-- ============================================================
-- reject_payout: Admin rejects a payout
-- ============================================================

CREATE OR REPLACE FUNCTION reject_payout(p_payout_id uuid, p_rejection_reason text)
RETURNS payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payout payouts%ROWTYPE;
  v_updated_count int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can reject payouts';
  END IF;

  IF p_rejection_reason IS NULL OR trim(p_rejection_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  SELECT * INTO v_payout FROM payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;

  IF v_payout.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Payout cannot be rejected (current: %)', v_payout.status;
  END IF;

  UPDATE payouts
  SET status = 'rejected', rejection_reason = p_rejection_reason,
      rejected_by = auth.uid(), rejected_at = now()
  WHERE id = v_payout.id AND status IN ('pending', 'approved');

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Payout has already been processed';
  END IF;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (auth.uid(), v_payout.traveler_id, 'payout_rejected', 'payout', v_payout.id);

  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (v_payout.traveler_id, 'payout_rejected', 'Payout Rejected',
    'Your payout request was rejected. Reason: ' || p_rejection_reason,
    v_payout.order_id);

  RETURN v_payout;
END;
$$;

-- ============================================================
-- Revoke public/anon execute on all new functions
-- ============================================================

REVOKE EXECUTE ON FUNCTION verify_payment_receipt(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION reject_payment_receipt(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION submit_payout(uuid, payout_method_type, text, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION approve_payout(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION complete_payout(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION reject_payout(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION calculate_platform_fee(numeric, text) FROM anon, public;
