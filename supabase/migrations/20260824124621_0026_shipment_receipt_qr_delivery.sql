/*
# Shipment Receipt Photo & QR-Based Delivery Verification

## Summary
Implements a secure shipment receipt and QR-based delivery verification flow.
The traveler must photograph the shipment before it can go in-transit, and
delivery is confirmed only by scanning a recipient QR code — no manual
"Mark as Delivered" button.

## 1. New Tables
- `shipment_receipt_photos` — one row per shipment receipt photo uploaded by the assigned traveler.
  - `id` (uuid PK)
  - `order_id` (uuid FK → orders, ON DELETE CASCADE)
  - `traveler_id` (uuid FK → profiles, ON DELETE SET NULL)
  - `storage_path` (text, not null — path in the `shipment-photos` storage bucket)
  - `created_at` (timestamptz, default now())
  - Unique on `order_id` so an order can have at most one receipt photo.
- `delivery_qr_tokens` — one active token per order, used for QR-based delivery confirmation.
  - `id` (uuid PK)
  - `order_id` (uuid FK → orders, ON DELETE CASCADE)
  - `token` (text, unique — 32-byte cryptographically random hex string)
  - `is_used` (boolean, default false)
  - `used_at` (timestamptz, nullable)
  - `used_by` (uuid FK → profiles, nullable, ON DELETE SET NULL)
  - `created_at` (timestamptz, default now())
  - Unique on `order_id` so an order has at most one QR token.

## 2. Storage
- Creates a PRIVATE storage bucket `shipment-photos` (10MB limit, image MIME types only).
- Storage policies: the assigned traveler can upload/read/delete within their own
  folder; admins can read all. No public access.

## 3. RPCs
- `record_shipment_receipt(p_order_id uuid, p_storage_path text)` — SECURITY DEFINER.
  Validates caller is the assigned traveler, order is in 'confirmed' status, and no
  receipt photo already exists. Inserts the photo row. Does NOT change order status
  (the traveler transitions to in_transit separately, and the guard enforces the photo).
- `generate_delivery_qr(p_order_id uuid)` — SECURITY DEFINER.
  Caller must be the sender or traveler of the order. Creates (or returns existing)
  delivery_qr_token for the order. Returns the token + a safe order reference.
- `verify_delivery_qr(p_token text)` — SECURITY DEFINER.
  The core delivery verification RPC. Validates caller is the assigned traveler,
  token exists, belongs to an order assigned to the caller, order is in 'in_transit',
  receipt photo exists, QR not already used, order not cancelled/delivered/completed.
  Atomically marks QR used (FOR UPDATE lock + conditional update) and sets order
  status to 'delivered'. The existing `create_tracking_event_and_notify` trigger
  fires the delivery notification automatically.

## 4. Guard Trigger Update
- `guard_order_status_transition()` updated: the `confirmed → in_transit` transition
  now requires a shipment_receipt_photos row to exist. This enforces the photo
  requirement at the database level — no client or RPC can bypass it.

## 5. RLS
- `shipment_receipt_photos`: SELECT for traveler+sender+admin; INSERT/UPDATE/DELETE
  denied for client roles (only the SECURITY DEFINER RPC inserts).
- `delivery_qr_tokens`: SELECT for traveler+sender+admin; INSERT/UPDATE/DELETE denied
  for client roles (only SECURITY DEFINER RPCs modify).

## 6. Audit
- `audit_action` enum extended with 'shipment_received' and 'delivery_verified'.
  The RPCs insert audit_logs rows. (audit_logs requires admin_id NOT NULL, so the
  RPCs use the caller's UUID as admin_id — consistent with the existing pattern where
  the actor is recorded.)
*/

-- ============================================================
-- 1. EXTEND audit_action ENUM
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'shipment_received' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')) THEN
    ALTER TYPE audit_action ADD VALUE 'shipment_received';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'delivery_verified' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')) THEN
    ALTER TYPE audit_action ADD VALUE 'delivery_verified';
  END IF;
END $$;

-- ============================================================
-- 2. shipment_receipt_photos TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS shipment_receipt_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  traveler_id uuid NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_receipt_one_per_order
  ON shipment_receipt_photos (order_id);

CREATE INDEX IF NOT EXISTS idx_srp_traveler_id ON shipment_receipt_photos (traveler_id);
CREATE INDEX IF NOT EXISTS idx_srp_order_id ON shipment_receipt_photos (order_id);

ALTER TABLE shipment_receipt_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "srp_select" ON shipment_receipt_photos;
CREATE POLICY "srp_select"
ON shipment_receipt_photos FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = shipment_receipt_photos.order_id
      AND (o.traveler_id = auth.uid() OR o.sender_id = auth.uid() OR public.is_admin())
  )
);

-- No INSERT/UPDATE/DELETE policies for client roles: deny by default.
-- Only the SECURITY DEFINER RPC (record_shipment_receipt) can insert.

-- ============================================================
-- 3. delivery_qr_tokens TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS delivery_qr_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  is_used boolean NOT NULL DEFAULT false,
  used_at timestamptz,
  used_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_qr_one_per_order
  ON delivery_qr_tokens (order_id);

CREATE INDEX IF NOT EXISTS idx_dqt_token ON delivery_qr_tokens (token);
CREATE INDEX IF NOT EXISTS idx_dqt_order_id ON delivery_qr_tokens (order_id);

ALTER TABLE delivery_qr_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dqt_select" ON delivery_qr_tokens;
CREATE POLICY "dqt_select"
ON delivery_qr_tokens FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = delivery_qr_tokens.order_id
      AND (o.traveler_id = auth.uid() OR o.sender_id = auth.uid() OR public.is_admin())
  )
);

-- No INSERT/UPDATE/DELETE policies for client roles: deny by default.
-- Only SECURITY DEFINER RPCs (generate_delivery_qr, verify_delivery_qr) can modify.

-- ============================================================
-- 4. STORAGE BUCKET: shipment-photos
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'shipment-photos',
  'shipment-photos',
  false,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Upload: traveler can upload to their own folder only
DROP POLICY IF EXISTS "storage_sp_upload_own" ON storage.objects;
CREATE POLICY "storage_sp_upload_own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'shipment-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Read: traveler can read their own uploads; admins can read all
DROP POLICY IF EXISTS "storage_sp_read_own" ON storage.objects;
CREATE POLICY "storage_sp_read_own"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'shipment-photos'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_admin()
  )
);

-- Delete: traveler can delete their own uploads
DROP POLICY IF EXISTS "storage_sp_delete_own" ON storage.objects;
CREATE POLICY "storage_sp_delete_own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'shipment-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ============================================================
-- 5. RPC: record_shipment_receipt
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_shipment_receipt(
  p_order_id uuid,
  p_storage_path text
)
RETURNS shipment_receipt_photos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_caller uuid;
  v_photo shipment_receipt_photos%ROWTYPE;
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
    RAISE EXCEPTION 'Unauthorized: only the assigned traveler can record a shipment receipt';
  END IF;

  IF v_order.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Shipment receipt can only be recorded for a confirmed order (current: %)', v_order.status;
  END IF;

  IF EXISTS (SELECT 1 FROM shipment_receipt_photos WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'A shipment receipt photo has already been recorded for this order';
  END IF;

  IF p_storage_path IS NULL OR char_length(trim(p_storage_path)) = 0 THEN
    RAISE EXCEPTION 'Storage path is required';
  END IF;

  INSERT INTO shipment_receipt_photos (order_id, traveler_id, storage_path)
  VALUES (p_order_id, v_caller, p_storage_path)
  RETURNING * INTO v_photo;

  -- Audit log (caller is the actor)
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_caller, v_caller, 'shipment_received', 'order', p_order_id);

  RETURN v_photo;
END;
$$;

REVOKE ALL ON FUNCTION public.record_shipment_receipt(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_shipment_receipt(uuid, text) TO authenticated;

-- ============================================================
-- 6. RPC: generate_delivery_qr
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_delivery_qr(p_order_id uuid)
RETURNS TABLE(token text, order_reference text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_caller uuid;
  v_token text;
  v_existing delivery_qr_tokens%ROWTYPE;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.traveler_id IS DISTINCT FROM v_caller AND v_order.sender_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Unauthorized: only a participant can generate a delivery QR';
  END IF;

  -- Return existing token if present
  SELECT * INTO v_existing FROM delivery_qr_tokens WHERE order_id = p_order_id;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.token, v_order.order_number;
    RETURN;
  END IF;

  -- Generate 32-byte cryptographically random token (64 hex chars)
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO delivery_qr_tokens (order_id, token)
  VALUES (p_order_id, v_token);

  RETURN QUERY SELECT v_token, v_order.order_number;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_delivery_qr(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_delivery_qr(uuid) TO authenticated;

-- ============================================================
-- 7. RPC: verify_delivery_qr
-- ============================================================
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
  IF NOT EXISTS (SELECT 1 FROM shipment_receipt_photos WHERE order_id = v_order.id) THEN
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

-- ============================================================
-- 8. UPDATE guard_order_status_transition: require receipt photo for in_transit
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

  IF OLD.status = 'pending' AND NEW.status = 'confirmed' THEN
    IF NEW.traveler_confirmed_at IS NULL THEN
      NEW.traveler_confirmed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
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

  IF OLD.status = 'confirmed' AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status = 'in_transit' AND NEW.status = 'delivered' THEN
    NEW.delivered_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status = 'in_transit' AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status = 'delivered' AND NEW.status = 'received' THEN
    NEW.received_at := now();
    IF NEW.sender_confirmed_at IS NULL THEN
      NEW.sender_confirmed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'received' AND NEW.status = 'completed' THEN
    NEW.completed_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid order status transition: % to %', OLD.status, NEW.status;
END;
$$;

-- ============================================================
-- 9. GRANTS
-- ============================================================
GRANT SELECT ON shipment_receipt_photos TO authenticated;
GRANT SELECT ON delivery_qr_tokens TO authenticated;
