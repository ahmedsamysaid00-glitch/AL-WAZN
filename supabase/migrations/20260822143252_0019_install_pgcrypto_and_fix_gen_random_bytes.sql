-- Install pgcrypto extension in the extensions schema (Supabase convention)
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Update create_order_from_collaboration to use schema-qualified extensions.gen_random_bytes
-- The function has search_path=public, so unqualified gen_random_bytes cannot be found.
-- We qualify it as extensions.gen_random_bytes to resolve the issue.

CREATE OR REPLACE FUNCTION public.create_order_from_collaboration(p_collaboration_id uuid)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_collab collaborations%ROWTYPE;
  v_trip trips%ROWTYPE;
  v_listing sender_listings%ROWTYPE;
  v_order orders%ROWTYPE;
  v_order_number text;
  v_platform_fee numeric;
  v_total numeric;
  v_agreed_weight numeric;
  v_agreed_price numeric;
BEGIN
  SELECT * INTO v_collab FROM collaborations WHERE id = p_collaboration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collaboration not found';
  END IF;

  -- Authorization: caller must be a participant in this collaboration
  IF v_collab.sender_id <> auth.uid() AND v_collab.traveler_id <> auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: you are not a participant in this collaboration';
  END IF;

  IF v_collab.status <> 'accepted' THEN
    RAISE EXCEPTION 'Order can only be created from an accepted collaboration (current: %)', v_collab.status;
  END IF;

  SELECT * INTO v_trip FROM trips WHERE id = v_collab.trip_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found';
  END IF;

  SELECT * INTO v_listing FROM sender_listings WHERE id = v_collab.sender_listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sender listing not found';
  END IF;

  IF v_trip.traveler_id <> v_collab.traveler_id THEN
    RAISE EXCEPTION 'Traveler ID mismatch between collaboration and trip';
  END IF;
  IF v_listing.sender_id <> v_collab.sender_id THEN
    RAISE EXCEPTION 'Sender ID mismatch between collaboration and listing';
  END IF;

  IF EXISTS (SELECT 1 FROM orders WHERE collaboration_id = p_collaboration_id) THEN
    RAISE EXCEPTION 'An order already exists for this collaboration';
  END IF;

  v_agreed_weight := COALESCE(v_collab.agreed_weight_kg, v_collab.proposed_weight_kg);
  v_agreed_price := COALESCE(v_collab.agreed_price, v_collab.proposed_price);
  v_platform_fee := calculate_platform_fee(v_agreed_price);
  v_total := v_agreed_price + v_platform_fee;

  v_order_number := 'ORD-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substring(encode(extensions.gen_random_bytes(4), 'hex') from 1 for 6));

  INSERT INTO orders (
    collaboration_id, trip_id, sender_listing_id, traveler_id, sender_id,
    order_number, status, agreed_weight_kg, agreed_price, platform_fee, total_amount,
    currency, pickup_location, delivery_location, expected_delivery_date
  ) VALUES (
    v_collab.id, v_trip.id, v_listing.id, v_collab.traveler_id, v_collab.sender_id,
    v_order_number, 'pending',
    v_agreed_weight, v_agreed_price, v_platform_fee, v_total,
    'USD',
    v_trip.origin,
    v_trip.destination,
    v_trip.arrival_date
  ) RETURNING * INTO v_order;

  INSERT INTO shipment_tracking_events (order_id, status, title, description, created_by)
  VALUES (
    v_order.id, 'order_created', 'Order Created',
    'Order has been created from an accepted collaboration.',
    auth.uid()
  );

  INSERT INTO notifications (user_id, type, title, body)
  VALUES
    (v_collab.traveler_id, 'order_created', 'New Order Created', 'A new order has been created for your trip.'),
    (v_collab.sender_id, 'order_created', 'New Order Created', 'A new order has been created for your shipment.');

  RETURN v_order;
END;
$$;

-- Re-grant EXECUTE to authenticated only (revoke anon/public)
REVOKE ALL ON FUNCTION public.create_order_from_collaboration(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_order_from_collaboration(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_order_from_collaboration(uuid) TO authenticated;
