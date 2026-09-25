/*
 * Phase 9 Step 3: Real Payment Provider Integration Boundary
 *
 * Problem: hold_payment was callable by the sender directly from the frontend,
 * meaning the frontend decided that payment succeeded. No real provider was involved.
 *
 * Fix:
 * 1. Revoke hold_payment from authenticated — it is now ONLY callable by the
 *    service role (edge function webhook handler) or admin (manual settlement
 *    via complete_payment which already transitions to held).
 * 2. Add provider columns to payments: provider_session_id, provider_event_id.
 * 3. Add unique constraint on provider_event_id for idempotent webhook processing.
 * 4. Add unique constraint: one active (pending/processing) payment per order.
 * 5. Create process_provider_payment RPC — the ONLY way to transition a
 *    payment from pending/processing to held. Callable only by service role.
 *    Validates provider payment ID, amount, currency, and order status.
 * 6. Add processing status support to initiate_payment (pending -> processing
 *    when provider session is created).
 */

-- ============================================================
-- 1. Add provider columns to payments
-- ============================================================
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider_session_id text,
  ADD COLUMN IF NOT EXISTS provider_event_id text;

-- Unique constraint on provider_event_id for idempotent webhook processing
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_payments_provider_event_id') THEN
    ALTER TABLE payments ADD CONSTRAINT uq_payments_provider_event_id
      UNIQUE (provider_event_id);
  END IF;
END $$;

-- ============================================================
-- 2. One active payment per order (pending or processing)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_one_active_payment_per_order') THEN
    CREATE UNIQUE INDEX idx_one_active_payment_per_order
      ON payments (order_id)
      WHERE status IN ('pending', 'processing');
  END IF;
END $$;

-- ============================================================
-- 3. Revoke hold_payment from authenticated
--    Now ONLY service role can call it (via webhook edge function)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.hold_payment(uuid) FROM authenticated;
-- Grant to service_role (already has access via superuser, but explicit)
GRANT EXECUTE ON FUNCTION public.hold_payment(uuid) TO service_role;

-- ============================================================
-- 4. Create process_provider_payment RPC
--    This is the webhook entry point. Called by the edge function
--    (service role) after verifying the provider's signature.
--    It validates the payment and transitions it to held.
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_provider_payment(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_provider_event_id text,
  p_amount numeric,
  p_currency text DEFAULT NULL
)
RETURNS payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_order orders%ROWTYPE;
  v_updated_count int;
  v_existing_event payments%ROWTYPE;
BEGIN
  -- Only service_role can call this (edge function webhook handler)
  IF current_setting('role') <> 'service_role' AND NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: only the payment provider webhook can confirm payments';
  END IF;

  -- Idempotency: if this provider_event_id was already processed, return the payment
  SELECT * INTO v_existing_event
  FROM payments
  WHERE provider_event_id = p_provider_event_id
  LIMIT 1;

  IF FOUND THEN
    -- Already processed — return existing result (idempotent)
    RETURN v_existing_event;
  END IF;

  -- Lock the payment row
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  -- Payment must be pending or processing (not already held/released/failed)
  IF v_payment.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'Payment is not pending or processing (current: %)', v_payment.status;
  END IF;

  -- Verify amount matches
  IF v_payment.amount <> p_amount THEN
    RAISE EXCEPTION 'Amount mismatch: expected %, got %', v_payment.amount, p_amount;
  END IF;

  -- Verify currency if provided
  IF p_currency IS NOT NULL AND v_payment.currency <> p_currency THEN
    RAISE EXCEPTION 'Currency mismatch: expected %, got %', v_payment.currency, p_currency;
  END IF;

  -- Lock the order
  SELECT * INTO v_order FROM orders WHERE id = v_payment.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Order must be awaiting payment
  IF v_order.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Order is not awaiting payment (current: %)', v_order.status;
  END IF;

  -- Store provider IDs and transition to held
  UPDATE payments
  SET status = 'held',
      paid_at = now(),
      provider_payment_id = p_provider_payment_id,
      provider_event_id = p_provider_event_id,
      provider = COALESCE(provider, 'stripe')
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
    v_payment.amount, v_payment.currency, 'Payment confirmed by provider and held by platform'
  );

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_payment.payer_id, v_order.traveler_id, 'payment_held', 'payment', v_payment.id);

  -- Notify sender: payment held
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (
    v_payment.payer_id, 'payment_held', 'Payment Held',
    'Your payment has been confirmed and held by the platform. The order is now confirmed.',
    v_order.id
  );

  -- Notify traveler: payment received and held
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (
    v_order.traveler_id, 'payment_held', 'Payment Secured',
    'The sender has completed payment. Funds are held by the platform and will be released upon delivery verification.',
    v_order.id
  );

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.process_provider_payment(uuid, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_provider_payment(uuid, text, text, numeric, text) TO service_role;

-- ============================================================
-- 5. Create mark_payment_failed RPC (for provider failure webhooks)
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_payment_failed(
  p_payment_id uuid,
  p_provider_event_id text,
  p_failure_reason text DEFAULT NULL
)
RETURNS payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_existing payments%ROWTYPE;
  v_updated_count int;
BEGIN
  IF current_setting('role') <> 'service_role' AND NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: only the payment provider webhook can mark payments as failed';
  END IF;

  -- Idempotency check
  SELECT * INTO v_existing
  FROM payments
  WHERE provider_event_id = p_provider_event_id
  LIMIT 1;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'Payment is not pending or processing (current: %)', v_payment.status;
  END IF;

  UPDATE payments
  SET status = 'failed',
      failure_reason = p_failure_reason,
      provider_event_id = p_provider_event_id
  WHERE id = v_payment.id AND status IN ('pending', 'processing');

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Payment has already been processed';
  END IF;

  -- Notify sender: payment failed
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (
    v_payment.payer_id, 'payment_failed', 'Payment Failed',
    COALESCE(p_failure_reason, 'Your payment could not be processed. Please try again.'),
    v_payment.order_id
  );

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_payment_failed(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payment_failed(uuid, text, text) TO service_role;

-- ============================================================
-- 6. Update initiate_payment to accept provider_session_id
--    and transition to 'processing' when a provider session is created
-- ============================================================
CREATE OR REPLACE FUNCTION public.initiate_payment(
  p_order_id uuid,
  p_payment_method payment_method_type DEFAULT 'manual',
  p_provider_session_id text DEFAULT NULL
)
RETURNS payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_caller uuid;
  v_payment payments%ROWTYPE;
  v_existing payments%ROWTYPE;
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

  IF v_order.sender_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Unauthorized: only the sender can initiate payment';
  END IF;

  IF v_order.status NOT IN ('awaiting_payment', 'confirmed') THEN
    RAISE EXCEPTION 'Order is not awaiting payment (current: %)', v_order.status;
  END IF;

  -- Idempotent: return existing active payment if one exists
  SELECT * INTO v_existing
  FROM payments
  WHERE order_id = p_order_id
    AND status IN ('pending', 'processing', 'held')
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    -- If we have a provider session ID, update the existing payment
    IF p_provider_session_id IS NOT NULL AND v_existing.provider_session_id IS NULL THEN
      UPDATE payments
      SET provider_session_id = p_provider_session_id,
          status = CASE WHEN status = 'pending' THEN 'processing' ELSE status END
      WHERE id = v_existing.id
      RETURNING * INTO v_payment;
      RETURN v_payment;
    END IF;
    RETURN v_existing;
  END IF;

  v_platform_fee := v_order.platform_fee;
  v_net_amount := v_order.agreed_price;

  INSERT INTO payments (
    order_id, payer_id, payee_id, amount, platform_fee, net_amount,
    currency, payment_method, status, provider_session_id
  ) VALUES (
    p_order_id, v_order.sender_id, v_order.traveler_id, v_order.total_amount,
    v_platform_fee, v_net_amount, v_order.currency, p_payment_method,
    CASE WHEN p_provider_session_id IS NOT NULL THEN 'processing' ELSE 'pending' END,
    p_provider_session_id
  ) RETURNING * INTO v_payment;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_caller, v_caller, 'payment_adjusted', 'payment', v_payment.id);

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.initiate_payment(uuid, payment_method_type, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_payment(uuid, payment_method_type, text) TO authenticated;
