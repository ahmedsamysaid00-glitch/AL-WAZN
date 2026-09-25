/*
# Phase 9 Step 2: Escrow Payment Lifecycle Integration

## Summary
Connects the Order lifecycle with the Payment/Wallet/Ledger system via a
real held-funds (escrow) model. Payments now flow: pending -> held -> released.
Funds are held by the platform after sender pays and only released to the
traveler wallet when delivery is QR-verified.

## Changes:

### 1. Constraint
- payments: CHECK constraint preventing status='released' without paid_at.

### 2. guard_order_status_transition (MODIFIED)
- Added: 'pending' -> 'awaiting_payment' (traveler accepts)
- Added: 'awaiting_payment' -> 'confirmed' (payment held via RPC)
- Added: 'awaiting_payment' -> 'cancelled' (cancel before payment)
- Removed: 'pending' -> 'confirmed' (must go through awaiting_payment)

### 3. create_tracking_event_and_notify (MODIFIED)
- Added handling for 'awaiting_payment' status (notifies sender: payment required)
- Updated 'confirmed' handling (payment held message)

### 4. initiate_payment (MODIFIED)
- Requires order status = 'awaiting_payment' (not just 'pending')
- No longer creates a ledger entry (ledger created when funds are held)
- Idempotent: returns existing active payment if one exists
- Now accepts payment_method parameter

### 5. hold_payment (NEW)
- Called by sender (payer) to confirm their payment
- Validates: caller is payer, order is 'awaiting_payment', payment is 'pending'
- Atomically: payment -> 'held', order -> 'confirmed', creates platform_held
  ledger entry, audit log, notifications to both parties
- Does NOT credit traveler wallet
- Idempotent: double calls rejected by status guard

### 6. release_payment (NEW)
- Called by verify_delivery_qr after successful QR verification
- Validates: payment is 'held', order is 'delivered'+, no prior release
- Atomically: payment -> 'released', credits traveler wallet, creates
  platform_release ledger entry, audit log, notification
- Idempotent: double calls rejected by status guard

### 7. verify_delivery_qr (MODIFIED)
- After QR consume + order -> 'delivered', calls release_payment internally
- Entire operation (QR + delivery + release + wallet + ledger + notifs) is atomic

### 8. complete_payment (MODIFIED)
- Admin-only manual settlement. Requires payment status = 'pending'.
- Transitions pending -> held (NOT released). Order -> confirmed if awaiting_payment.
- Creates platform_held ledger entry. Does NOT credit traveler wallet.

### 9. request_refund (MODIFIED)
- Accepts payments in 'held' status (in addition to 'paid')
- Refunds held payments: funds return to sender (no wallet debit since traveler
  was never credited)

### 10. complete_refund (MODIFIED)
- For held payments: no wallet debit needed (funds never credited to traveler)
- For released payments: blocked (funds already with traveler)
- Creates appropriate ledger entry based on payment status

### 11. process_refund (MODIFIED)
- Updated to handle 'held' payment status in addition to 'paid'

### 12. get_payment_stats (MODIFIED)
- Includes held and released amounts in stats

### 13. accept_order (NEW)
- Traveler accepts order: pending -> awaiting_payment
- Idempotent: status guard prevents double acceptance

### 14. Data migration
- Orders currently 'pending' with traveler_confirmed_at set -> 'awaiting_payment'
*/

-- ============================================================
-- 1. CONSTRAINT: released payments must have paid_at
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_released_requires_paid_at') THEN
    ALTER TABLE payments ADD CONSTRAINT chk_released_requires_paid_at
      CHECK (status <> 'released' OR paid_at IS NOT NULL);
  END IF;
END $$;

-- ============================================================
-- 2. UPDATE guard_order_status_transition
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- pending -> awaiting_payment (traveler accepts)
  IF OLD.status = 'pending' AND NEW.status = 'awaiting_payment' THEN
    IF NEW.traveler_confirmed_at IS NULL THEN
      NEW.traveler_confirmed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- pending -> cancelled (cancel before acceptance)
  IF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now();
    RETURN NEW;
  END IF;

  -- awaiting_payment -> confirmed (payment held — via RPC only)
  IF OLD.status = 'awaiting_payment' AND NEW.status = 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- awaiting_payment -> cancelled (cancel before payment)
  IF OLD.status = 'awaiting_payment' AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now();
    RETURN NEW;
  END IF;

  -- confirmed -> in_transit: REQUIRE shipment receipt photo
  IF OLD.status = 'confirmed' AND NEW.status = 'in_transit' THEN
    IF NOT EXISTS (SELECT 1 FROM shipment_receipt_photos WHERE order_id = NEW.id) THEN
      RAISE EXCEPTION 'You must photograph the shipment before continuing.';
    END IF;
    RETURN NEW;
  END IF;

  -- confirmed -> cancelled
  IF OLD.status = 'confirmed' AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now();
    RETURN NEW;
  END IF;

  -- in_transit -> delivered
  IF OLD.status = 'in_transit' AND NEW.status = 'delivered' THEN
    NEW.delivered_at := now();
    RETURN NEW;
  END IF;

  -- in_transit -> cancelled
  IF OLD.status = 'in_transit' AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now();
    RETURN NEW;
  END IF;

  -- delivered -> received
  IF OLD.status = 'delivered' AND NEW.status = 'received' THEN
    NEW.received_at := now();
    IF NEW.sender_confirmed_at IS NULL THEN
      NEW.sender_confirmed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- received -> completed
  IF OLD.status = 'received' AND NEW.status = 'completed' THEN
    NEW.completed_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid order status transition: % to %', OLD.status, NEW.status;
END;
$$;

-- ============================================================
-- 3. UPDATE create_tracking_event_and_notify
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_tracking_event_and_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event_status tracking_event_type;
  v_title text;
  v_description text;
  v_notify_user_id uuid;
  v_notify_type notification_type;
  v_notify_title text;
  v_notify_body text;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'awaiting_payment' THEN
      v_event_status := 'order_confirmed';
      v_title := 'Order Accepted — Payment Required';
      v_description := 'The traveler has accepted the order. Payment is required to confirm.';
      v_notify_user_id := NEW.sender_id;
      v_notify_type := 'order_awaiting_payment';
      v_notify_title := 'Payment Required';
      v_notify_body := 'The traveler has accepted your order. Please complete payment to confirm.';

    WHEN 'confirmed' THEN
      v_event_status := 'order_confirmed';
      v_title := 'Order Confirmed';
      v_description := 'Payment has been received and held. The order is now confirmed.';
      v_notify_user_id := NEW.sender_id;
      v_notify_type := 'order_confirmed';
      v_notify_title := 'Order Confirmed';
      v_notify_body := 'Your payment has been received and your order is now confirmed.';

    WHEN 'in_transit' THEN
      v_event_status := 'shipment_in_transit';
      v_title := 'Shipment In Transit';
      v_description := 'The shipment has been picked up and is now in transit.';
      v_notify_user_id := NEW.sender_id;
      v_notify_type := 'shipment_in_transit';
      v_notify_title := 'Shipment In Transit';
      v_notify_body := 'Your shipment is now in transit.';

    WHEN 'delivered' THEN
      v_event_status := 'shipment_delivered';
      v_title := 'Shipment Delivered';
      v_description := 'The shipment has been delivered to the destination.';
      v_notify_user_id := NEW.sender_id;
      v_notify_type := 'shipment_delivered';
      v_notify_title := 'Shipment Delivered';
      v_notify_body := 'Your shipment has been delivered. Please confirm receipt.';

    WHEN 'received' THEN
      v_event_status := 'receipt_confirmed';
      v_title := 'Receipt Confirmed';
      v_description := 'The sender has confirmed receipt of the shipment.';
      v_notify_user_id := NEW.traveler_id;
      v_notify_type := 'receipt_confirmed';
      v_notify_title := 'Receipt Confirmed';
      v_notify_body := 'The sender has confirmed receipt of the shipment.';

    WHEN 'completed' THEN
      v_event_status := 'order_completed';
      v_title := 'Order Completed';
      v_description := 'The order has been completed successfully.';
      v_notify_user_id := CASE WHEN auth.uid() = NEW.traveler_id THEN NEW.sender_id ELSE NEW.traveler_id END;
      v_notify_type := 'order_completed';
      v_notify_title := 'Order Completed';
      v_notify_body := 'The order has been completed.';

    WHEN 'cancelled' THEN
      v_event_status := 'order_cancelled';
      v_title := 'Order Cancelled';
      v_description := COALESCE(NEW.cancellation_reason, 'The order has been cancelled.');
      v_notify_user_id := CASE WHEN auth.uid() = NEW.traveler_id THEN NEW.sender_id ELSE NEW.traveler_id END;
      v_notify_type := 'order_cancelled';
      v_notify_title := 'Order Cancelled';
      v_notify_body := COALESCE(NEW.cancellation_reason, 'The order has been cancelled.');

    ELSE
      RETURN NEW;
  END CASE;

  INSERT INTO shipment_tracking_events (order_id, status, title, description, location, created_by)
  VALUES (NEW.id, v_event_status, v_title, v_description, NULL, COALESCE(auth.uid(), NEW.sender_id));

  IF v_notify_user_id IS NOT NULL AND v_notify_user_id <> COALESCE(auth.uid(), NEW.sender_id) THEN
    INSERT INTO notifications (user_id, type, title, body, related_order_id)
    VALUES (v_notify_user_id, v_notify_type, v_notify_title, v_notify_body, NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 4. MODIFY initiate_payment
-- ============================================================
CREATE OR REPLACE FUNCTION public.initiate_payment(
  p_order_id uuid,
  p_payment_method payment_method_type DEFAULT 'manual'
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
    AND status IN ('pending', 'held')
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  v_platform_fee := v_order.platform_fee;
  v_net_amount := v_order.agreed_price;

  INSERT INTO payments (
    order_id, payer_id, payee_id, amount, platform_fee, net_amount,
    currency, payment_method, status
  ) VALUES (
    p_order_id, v_order.sender_id, v_order.traveler_id, v_order.total_amount,
    v_platform_fee, v_net_amount, v_order.currency, p_payment_method, 'pending'
  ) RETURNING * INTO v_payment;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_caller, v_caller, 'payment_adjusted', 'payment', v_payment.id);

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.initiate_payment(uuid, payment_method_type) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_payment(uuid, payment_method_type) TO authenticated;

-- ============================================================
-- 5. NEW RPC: hold_payment
-- ============================================================
CREATE OR REPLACE FUNCTION public.hold_payment(p_payment_id uuid)
RETURNS payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid;
  v_payment payments%ROWTYPE;
  v_order orders%ROWTYPE;
  v_updated_count int;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.payer_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Unauthorized: only the payer can confirm this payment';
  END IF;

  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment is not pending (current: %)', v_payment.status;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_payment.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Order is not awaiting payment (current: %)', v_order.status;
  END IF;

  -- Atomically transition payment to held (status guard prevents double execution)
  UPDATE payments
  SET status = 'held', paid_at = now()
  WHERE id = v_payment.id AND status = 'pending';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Payment has already been processed';
  END IF;

  -- Transition order to confirmed
  UPDATE orders SET status = 'confirmed' WHERE id = v_order.id;

  -- Create platform_held ledger entry (funds held by platform, not yet in traveler wallet)
  INSERT INTO financial_ledger_entries (
    payment_id, order_id, user_id, entry_type, direction, amount, currency, description
  ) VALUES (
    v_payment.id, v_order.id, v_caller, 'platform_held', 'credit',
    v_payment.amount, v_payment.currency, 'Payment held by platform pending delivery verification'
  );

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_caller, v_order.traveler_id, 'payment_held', 'payment', v_payment.id);

  -- Notify sender: payment held
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (v_caller, 'payment_held', 'Payment Held', 'Your payment has been received and held by the platform. The order is now confirmed.', v_order.id);

  -- Notify traveler: payment received and held
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (v_order.traveler_id, 'payment_held', 'Payment Secured', 'The sender has completed payment. Funds are held by the platform and will be released upon delivery verification.', v_order.id);

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.hold_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hold_payment(uuid) TO authenticated;

-- ============================================================
-- 6. NEW RPC: release_payment
-- ============================================================
CREATE OR REPLACE FUNCTION public.release_payment(p_payment_id uuid)
RETURNS payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid;
  v_payment payments%ROWTYPE;
  v_order orders%ROWTYPE;
  v_updated_count int;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.status <> 'held' THEN
    RAISE EXCEPTION 'Payment is not held (current: %)', v_payment.status;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_payment.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Only the assigned traveler or an admin can trigger release
  IF v_order.traveler_id IS DISTINCT FROM v_caller AND NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: only the assigned traveler can trigger release';
  END IF;

  -- Order must be delivered (or further) to release funds
  IF v_order.status NOT IN ('delivered', 'received', 'completed') THEN
    RAISE EXCEPTION 'Order must be delivered before funds can be released (current: %)', v_order.status;
  END IF;

  -- Atomically transition payment to released (status guard prevents double release)
  UPDATE payments
  SET status = 'released'
  WHERE id = v_payment.id AND status = 'held';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Payment has already been released';
  END IF;

  -- Credit traveler wallet (create wallet if it doesn't exist)
  INSERT INTO wallet_accounts (user_id, currency, available_balance, pending_balance)
  VALUES (v_order.traveler_id, v_payment.currency, v_payment.net_amount, 0)
  ON CONFLICT (user_id, currency) DO UPDATE
    SET available_balance = wallet_accounts.available_balance + v_payment.net_amount,
        updated_at = now();

  -- Create platform_release ledger entry
  INSERT INTO financial_ledger_entries (
    payment_id, order_id, user_id, entry_type, direction, amount, currency, description
  ) VALUES (
    v_payment.id, v_order.id, v_order.traveler_id, 'platform_release', 'credit',
    v_payment.net_amount, v_payment.currency, 'Funds released to traveler wallet after delivery verification'
  );

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_caller, v_order.traveler_id, 'payment_released', 'payment', v_payment.id);

  -- Notify traveler: funds released
  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (v_order.traveler_id, 'payment_released', 'Payment Released', 'Your payment has been released to your wallet after successful delivery verification.', v_order.id);

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.release_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_payment(uuid) TO authenticated;

-- ============================================================
-- 7. MODIFY verify_delivery_qr: trigger release after delivery
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_delivery_qr(p_token text)
RETURNS TABLE(success boolean, order_id uuid, order_reference text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_caller uuid;
  v_token_row delivery_qr_tokens%ROWTYPE;
  v_order orders%ROWTYPE;
  v_payment payments%ROWTYPE;
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
  IF v_order.status IN ('delivered', 'received', 'completed') THEN
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

  -- Find the held payment for this order and release funds to traveler
  SELECT * INTO v_payment
  FROM payments
  WHERE order_id = v_order.id
    AND status = 'held'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    -- Release funds: payment -> released, wallet credited, ledger created, notification sent
    -- All within this same transaction — atomic with the QR consume + order delivery
    PERFORM public.release_payment(v_payment.id);
  END IF;

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_caller, v_caller, 'delivery_verified', 'order', v_order.id);

  RETURN QUERY SELECT true, v_order.id, v_order.order_number;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_delivery_qr(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_delivery_qr(text) TO authenticated;

-- ============================================================
-- 8. MODIFY complete_payment (admin manual settlement only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_payment(p_payment_id uuid)
RETURNS payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid;
  v_payment payments%ROWTYPE;
  v_order orders%ROWTYPE;
  v_updated_count int;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can manually complete payments';
  END IF;

  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending payments can be manually completed (current: %)', v_payment.status;
  END IF;

  -- Atomically transition to held (not released — release happens via delivery QR)
  UPDATE payments
  SET status = 'held', paid_at = now()
  WHERE id = v_payment.id AND status = 'pending';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Payment has already been processed';
  END IF;

  -- If order is awaiting_payment, transition to confirmed
  SELECT * INTO v_order FROM orders WHERE id = v_payment.order_id FOR UPDATE;
  IF FOUND AND v_order.status = 'awaiting_payment' THEN
    UPDATE orders SET status = 'confirmed' WHERE id = v_order.id;
  END IF;

  -- Create platform_held ledger entry
  INSERT INTO financial_ledger_entries (
    payment_id, order_id, user_id, entry_type, direction, amount, currency, description
  ) VALUES (
    v_payment.id, v_order.id, v_caller, 'platform_held', 'credit',
    v_payment.amount, v_payment.currency, 'Manual settlement: payment held by platform (admin)'
  );

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_caller, v_order.traveler_id, 'payment_held', 'payment', v_payment.id);

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_payment(uuid) TO authenticated;

-- ============================================================
-- 9. MODIFY request_refund: accept 'held' status
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_refund(
  p_payment_id uuid,
  p_amount numeric,
  p_reason text DEFAULT NULL
)
RETURNS refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid;
  v_payment payments%ROWTYPE;
  v_order orders%ROWTYPE;
  v_existing_refunds numeric;
  v_refundable_amount numeric;
  v_refund refunds%ROWTYPE;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be greater than zero';
  END IF;

  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.payer_id IS DISTINCT FROM v_caller AND NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: only the payer or an admin can request a refund';
  END IF;

  -- Allow refunds on held and paid payments
  IF v_payment.status NOT IN ('held', 'paid') THEN
    RAISE EXCEPTION 'Payment is not refundable (current: %)', v_payment.status;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_existing_refunds
  FROM refunds
  WHERE payment_id = p_payment_id
    AND status IN ('requested', 'approved', 'processing', 'completed');

  v_refundable_amount := v_payment.amount - v_existing_refunds;
  IF p_amount > v_refundable_amount THEN
    RAISE EXCEPTION 'Refund amount exceeds refundable amount';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_payment.order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  INSERT INTO refunds (
    payment_id, order_id, amount, reason, status, requested_by
  ) VALUES (
    p_payment_id, v_order.id, p_amount, p_reason, 'requested', v_caller
  ) RETURNING * INTO v_refund;

  INSERT INTO notifications (user_id, type, title, body, related_order_id)
  VALUES (v_caller, 'payment_refund_requested', 'Refund Requested', 'Your refund request has been submitted.', v_order.id);

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_caller, v_payment.payee_id, 'refund_approved', 'refund', v_refund.id);

  RETURN v_refund;
END;
$$;

REVOKE ALL ON FUNCTION public.request_refund(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_refund(uuid, numeric, text) TO authenticated;

-- ============================================================
-- 10. MODIFY process_refund: handle 'held' payment status
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_refund(p_refund_id uuid)
RETURNS refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
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
      WHERE id = v_refund.payment_id AND status IN ('paid', 'held', 'partially_refunded');
  ELSE
    UPDATE payments SET status = 'partially_refunded'
      WHERE id = v_refund.payment_id AND status IN ('paid', 'held');
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

REVOKE ALL ON FUNCTION public.process_refund(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_refund(uuid) TO authenticated;

-- ============================================================
-- 11. MODIFY complete_refund: handle held vs released payments
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_refund(p_refund_id uuid)
RETURNS refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_refund refunds%ROWTYPE;
  v_payment payments%ROWTYPE;
  v_order orders%ROWTYPE;
  v_updated_count int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can complete refunds';
  END IF;

  -- Atomic UPDATE with status guard
  UPDATE refunds
    SET status = 'completed', processed_at = now()
    WHERE id = p_refund_id AND status = 'processing'
    RETURNING * INTO v_refund;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund not found or not in processing status';
  END IF;

  SELECT * INTO v_payment FROM payments WHERE id = v_refund.payment_id FOR UPDATE;
  SELECT * INTO v_order FROM orders WHERE id = v_refund.order_id;

  -- For held payments: funds were never credited to traveler, so no wallet debit needed.
  -- Just mark payment as refunded and credit the sender's wallet.
  IF v_payment.status = 'held' THEN
    -- Mark payment as refunded
    UPDATE payments
    SET status = 'refunded', refunded_at = now()
    WHERE id = v_payment.id AND status = 'held';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count = 0 THEN
      RAISE EXCEPTION 'Payment status changed during refund processing';
    END IF;

    -- Credit payer's wallet with refund amount (returning held funds to sender)
    INSERT INTO wallet_accounts (user_id, currency, available_balance, pending_balance)
    VALUES (v_payment.payer_id, v_payment.currency, v_refund.amount, 0)
    ON CONFLICT (user_id, currency)
    DO UPDATE SET available_balance = wallet_accounts.available_balance + v_refund.amount;

    -- Ledger entry: refund from held funds to sender
    INSERT INTO financial_ledger_entries (payment_id, order_id, user_id, entry_type, direction, amount, currency, description)
    VALUES (v_payment.id, v_order.id, v_payment.payer_id, 'refund', 'credit', v_refund.amount, v_payment.currency, 'Refund completed - held funds returned to sender');

  -- For released payments: funds already with traveler — debit traveler wallet
  ELSIF v_payment.status = 'released' THEN
    -- Debit traveler wallet
    UPDATE wallet_accounts
    SET available_balance = available_balance - v_refund.amount,
        updated_at = now()
    WHERE user_id = v_payment.payee_id AND currency = v_payment.currency;

    -- Mark payment as refunded
    UPDATE payments
    SET status = 'refunded', refunded_at = now()
    WHERE id = v_payment.id AND status = 'released';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count = 0 THEN
      RAISE EXCEPTION 'Payment status changed during refund processing';
    END IF;

    -- Credit payer's wallet
    INSERT INTO wallet_accounts (user_id, currency, available_balance, pending_balance)
    VALUES (v_payment.payer_id, v_payment.currency, v_refund.amount, 0)
    ON CONFLICT (user_id, currency)
    DO UPDATE SET available_balance = wallet_accounts.available_balance + v_refund.amount;

    -- Ledger entry: refund debited from traveler, credited to sender
    INSERT INTO financial_ledger_entries (payment_id, order_id, user_id, entry_type, direction, amount, currency, description)
    VALUES (v_payment.id, v_order.id, v_payment.payee_id, 'refund', 'debit', v_refund.amount, v_payment.currency, 'Refund completed - debited from traveler wallet');

  -- For paid payments (legacy): same as released — debit traveler
  ELSIF v_payment.status = 'paid' THEN
    UPDATE wallet_accounts
    SET available_balance = available_balance - v_refund.amount,
        updated_at = now()
    WHERE user_id = v_payment.payee_id AND currency = v_payment.currency;

    UPDATE payments
    SET status = 'refunded', refunded_at = now()
    WHERE id = v_payment.id AND status = 'paid';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count = 0 THEN
      RAISE EXCEPTION 'Payment status changed during refund processing';
    END IF;

    INSERT INTO wallet_accounts (user_id, currency, available_balance, pending_balance)
    VALUES (v_payment.payer_id, v_payment.currency, v_refund.amount, 0)
    ON CONFLICT (user_id, currency)
    DO UPDATE SET available_balance = wallet_accounts.available_balance + v_refund.amount;

    INSERT INTO financial_ledger_entries (payment_id, order_id, user_id, entry_type, direction, amount, currency, description)
    VALUES (v_payment.id, v_order.id, v_payment.payee_id, 'refund', 'debit', v_refund.amount, v_payment.currency, 'Refund completed - debited from traveler wallet (legacy)');

  ELSE
    RAISE EXCEPTION 'Cannot refund payment in status %', v_payment.status;
  END IF;

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

REVOKE ALL ON FUNCTION public.complete_refund(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_refund(uuid) TO authenticated;

-- ============================================================
-- 12. UPDATE get_payment_stats: include held and released
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_payment_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_volume numeric := 0;
  v_fees numeric := 0;
  v_pending int := 0;
  v_held numeric := 0;
  v_released numeric := 0;
  v_successful int := 0;
  v_failed int := 0;
  v_refunded numeric := 0;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can view payment statistics';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_volume FROM payments WHERE status IN ('held', 'released');
  SELECT COALESCE(SUM(platform_fee), 0) INTO v_fees FROM payments WHERE status IN ('held', 'released');
  SELECT COUNT(*) INTO v_pending FROM payments WHERE status IN ('pending', 'processing');
  SELECT COALESCE(SUM(amount), 0) INTO v_held FROM payments WHERE status = 'held';
  SELECT COALESCE(SUM(net_amount), 0) INTO v_released FROM payments WHERE status = 'released';
  SELECT COUNT(*) INTO v_successful FROM payments WHERE status IN ('held', 'released');
  SELECT COUNT(*) INTO v_failed FROM payments WHERE status = 'failed';
  SELECT COALESCE(SUM(amount), 0) INTO v_refunded FROM refunds WHERE status IN ('processing', 'completed');

  RETURN json_build_object(
    'volume', v_volume,
    'fees', v_fees,
    'pending', v_pending,
    'held', v_held,
    'released', v_released,
    'successful', v_successful,
    'failed', v_failed,
    'refunded', v_refunded
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION get_payment_stats() TO authenticated;

-- ============================================================
-- 13. NEW RPC: accept_order (traveler accepts, pending -> awaiting_payment)
-- ============================================================
CREATE OR REPLACE FUNCTION public.accept_order(p_order_id uuid)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid;
  v_order orders%ROWTYPE;
  v_updated_count int;
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
    RAISE EXCEPTION 'Unauthorized: only the assigned traveler can accept this order';
  END IF;

  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Order is not pending (current: %)', v_order.status;
  END IF;

  -- Atomically transition to awaiting_payment
  UPDATE orders
  SET status = 'awaiting_payment', traveler_confirmed_at = now()
  WHERE id = v_order.id AND status = 'pending';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Order has already been accepted';
  END IF;

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_order(uuid) TO authenticated;

-- ============================================================
-- 14. MIGRATE EXISTING ORDERS
-- ============================================================
-- Orders currently 'pending' with traveler_confirmed_at set -> 'awaiting_payment'
UPDATE orders SET status = 'awaiting_payment'
WHERE status = 'pending' AND traveler_confirmed_at IS NOT NULL;
