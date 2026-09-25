-- Phase 8: Add negative amount validation to request_refund
-- The existing request_refund RPC checks that refund amount doesn't exceed
-- refundable amount, but does NOT validate that the amount is positive.
-- A negative refund amount would bypass the exceedance check.

CREATE OR REPLACE FUNCTION request_refund(p_payment_id uuid, p_amount numeric, p_reason text)
RETURNS refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_existing_refunded numeric;
  v_refund refunds%ROWTYPE;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.payer_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the payer can request a refund';
  END IF;

  IF v_payment.status NOT IN ('paid', 'partially_refunded') THEN
    RAISE EXCEPTION 'Refund can only be requested for paid payments';
  END IF;

  -- Reject negative or zero refund amounts
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be greater than zero';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_existing_refunded
  FROM refunds
  WHERE payment_id = p_payment_id
    AND status IN ('requested', 'approved', 'processing', 'completed');

  IF p_amount > (v_payment.amount - v_existing_refunded) THEN
    RAISE EXCEPTION 'Refund amount exceeds refundable amount';
  END IF;

  INSERT INTO refunds (payment_id, order_id, amount, reason, status, requested_by)
  VALUES (p_payment_id, v_payment.order_id, p_amount, p_reason, 'requested', auth.uid())
  RETURNING * INTO v_refund;

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

REVOKE EXECUTE ON FUNCTION request_refund(uuid, numeric, text) FROM anon;
