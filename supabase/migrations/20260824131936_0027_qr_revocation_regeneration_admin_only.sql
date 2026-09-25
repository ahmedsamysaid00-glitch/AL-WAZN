-- ============================================================
-- QR Revocation & Regeneration — ADMIN ONLY
-- Adds is_revoked columns, revoke_delivery_qr + regenerate_delivery_qr RPCs
-- Updates verify_delivery_qr to reject revoked tokens
-- ============================================================

-- 1. Extend audit_action enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'qr_revoked' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')) THEN
    ALTER TYPE audit_action ADD VALUE 'qr_revoked';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'qr_regenerated' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')) THEN
    ALTER TYPE audit_action ADD VALUE 'qr_regenerated';
  END IF;
END $$;

-- 2. Add revocation columns to delivery_qr_tokens
ALTER TABLE delivery_qr_tokens
  ADD COLUMN IF NOT EXISTS is_revoked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dqt_is_revoked ON delivery_qr_tokens (is_revoked);

-- 3. RPC: revoke_delivery_qr — ADMIN ONLY
CREATE OR REPLACE FUNCTION public.revoke_delivery_qr(p_order_id uuid)
RETURNS TABLE(success boolean, order_reference text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid;
  v_caller_role text;
  v_order orders%ROWTYPE;
  v_token_row delivery_qr_tokens%ROWTYPE;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify caller's profile exists and role is admin
  SELECT role::text INTO v_caller_role FROM profiles WHERE id = v_caller;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: only administrators can revoke delivery QR codes';
  END IF;

  -- Verify order exists
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Order must not be delivered, completed, or cancelled
  IF v_order.status IN ('delivered', 'received', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot revoke QR for an order that is %', v_order.status;
  END IF;

  -- Find the token
  SELECT * INTO v_token_row FROM delivery_qr_tokens WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No delivery QR exists for this order';
  END IF;

  -- Already revoked?
  IF v_token_row.is_revoked THEN
    RAISE EXCEPTION 'This delivery QR has already been revoked';
  END IF;

  -- Already used?
  IF v_token_row.is_used THEN
    RAISE EXCEPTION 'Cannot revoke a QR that has already been used for delivery';
  END IF;

  -- Revoke
  UPDATE delivery_qr_tokens
  SET is_revoked = true, revoked_at = now(), revoked_by = v_caller
  WHERE id = v_token_row.id;

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_caller, v_caller, 'qr_revoked', 'order', p_order_id);

  RETURN QUERY SELECT true, v_order.order_number;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_delivery_qr(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_delivery_qr(uuid) TO authenticated;

-- 4. RPC: regenerate_delivery_qr — ADMIN ONLY
-- Revokes the old token (if exists and not used) and creates a new one
CREATE OR REPLACE FUNCTION public.regenerate_delivery_qr(p_order_id uuid)
RETURNS TABLE(token text, order_reference text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid;
  v_caller_role text;
  v_order orders%ROWTYPE;
  v_existing delivery_qr_tokens%ROWTYPE;
  v_new_token text;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify caller's profile exists and role is admin
  SELECT role::text INTO v_caller_role FROM profiles WHERE id = v_caller;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: only administrators can regenerate delivery QR codes';
  END IF;

  -- Verify order exists
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Order must not be delivered, completed, or cancelled
  IF v_order.status IN ('delivered', 'received', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot regenerate QR for an order that is %', v_order.status;
  END IF;

  -- Check existing token
  SELECT * INTO v_existing FROM delivery_qr_tokens WHERE order_id = p_order_id FOR UPDATE;
  IF FOUND THEN
    -- If already used, cannot regenerate
    IF v_existing.is_used THEN
      RAISE EXCEPTION 'Cannot regenerate QR for an order whose QR has already been used for delivery';
    END IF;

    -- Revoke the old token
    UPDATE delivery_qr_tokens
    SET is_revoked = true, revoked_at = now(), revoked_by = v_caller
    WHERE id = v_existing.id AND is_revoked = false;

    -- Delete the old token row so the unique constraint allows a new one
    DELETE FROM delivery_qr_tokens WHERE id = v_existing.id;
  END IF;

  -- Generate new 32-byte cryptographically random token
  v_new_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO delivery_qr_tokens (order_id, token)
  VALUES (p_order_id, v_new_token);

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_caller, v_caller, 'qr_regenerated', 'order', p_order_id);

  RETURN QUERY SELECT v_new_token, v_order.order_number;
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_delivery_qr(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_delivery_qr(uuid) TO authenticated;

-- 5. Update verify_delivery_qr to reject revoked tokens
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

  -- Reject revoked QR
  IF v_token_row.is_revoked THEN
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

  -- Update order to delivered
  UPDATE orders SET status = 'delivered' WHERE id = v_order.id;

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_caller, v_caller, 'delivery_verified', 'order', v_order.id);

  RETURN QUERY SELECT true, v_order.id, v_order.order_number;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_delivery_qr(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_delivery_qr(text) TO authenticated;
