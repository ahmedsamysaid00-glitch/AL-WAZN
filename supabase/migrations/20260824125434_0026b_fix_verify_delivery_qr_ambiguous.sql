-- Fix verify_delivery_qr: ambiguous column reference between RETURNS TABLE and query columns
-- The RETURN QUERY SELECT used v_order.id which conflicts with the output column name "order_id"

CREATE OR REPLACE FUNCTION public.verify_delivery_qr(p_token text)
RETURNS TABLE(success boolean, order_id uuid, order_reference text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid;
  v_token_row delivery_qr_tokens%ROWTYPE;
  v_order orders%ROWTYPE;
  v_updated_count int;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_token IS NULL OR char_length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'Invalid QR code';
  END IF;

  -- Lock the token row
  SELECT * INTO v_token_row
  FROM delivery_qr_tokens
  WHERE token = trim(p_token)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This QR code is not valid for this delivery.';
  END IF;

  -- Lock the order row
  SELECT * INTO v_order
  FROM orders
  WHERE id = v_token_row.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This QR code is not valid for this delivery.';
  END IF;

  -- Wrong traveler check
  IF v_order.traveler_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'This QR code is not valid for this delivery.';
  END IF;

  -- QR already used
  IF v_token_row.is_used THEN
    RAISE EXCEPTION 'This delivery QR has already been used.';
  END IF;

  -- Order state checks
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot deliver a cancelled order';
  END IF;
  IF v_order.status = 'delivered' OR v_order.status = 'received' OR v_order.status = 'completed' THEN
    RAISE EXCEPTION 'This order has already been delivered';
  END IF;
  IF v_order.status <> 'in_transit' THEN
    RAISE EXCEPTION 'This order is not in transit and cannot be delivered';
  END IF;

  -- Shipment receipt photo must exist
  IF NOT EXISTS (SELECT 1 FROM shipment_receipt_photos srp WHERE srp.order_id = v_order.id) THEN
    RAISE EXCEPTION 'You must confirm receipt of the shipment before completing delivery.';
  END IF;

  -- Atomically consume the QR: conditional update ensures only one wins
  UPDATE delivery_qr_tokens
  SET is_used = true, used_at = now(), used_by = v_caller
  WHERE id = v_token_row.id AND is_used = false;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'This delivery QR has already been used.';
  END IF;

  -- Update order to delivered (guard_order_status_transition + create_tracking_event_and_notify fire)
  UPDATE orders SET status = 'delivered' WHERE id = v_order.id;

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_caller, v_caller, 'delivery_verified', 'order', v_order.id);

  RETURN QUERY SELECT true, v_order.id, v_order.order_number;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_delivery_qr(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_delivery_qr(text) TO authenticated;
