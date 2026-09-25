/*
# Orders & Shipment Tracking System (Phase 6)

## Overview
Creates the complete Order + Shipment Tracking system that starts after a collaboration is accepted.
Enables Travelers, Senders, and Admins to track the full lifecycle of a shipment.

## New Enum Types
1. `order_status`: pending, confirmed, in_transit, delivered, received, completed, cancelled
2. `tracking_event_type`: order_created, order_confirmed, shipment_picked_up, shipment_in_transit, shipment_delivered, receipt_confirmed, order_completed, order_cancelled

## New Tables
### orders
- id (uuid, PK), collaboration_id (uuid FK UNIQUE), trip_id (uuid FK), sender_listing_id (uuid FK)
- traveler_id (uuid FK), sender_id (uuid FK), order_number (text UNIQUE)
- status (order_status enum, default pending), agreed_weight_kg (numeric >0), agreed_price (numeric >=0)
- platform_fee (numeric >=0 default 0), total_amount (numeric >=0), currency (text default USD)
- pickup_location, delivery_location (text nullable), expected_delivery_date (date nullable)
- sender_confirmed_at, traveler_confirmed_at, delivered_at, received_at, completed_at, cancelled_at (timestamptz nullable)
- cancellation_reason (text nullable), created_at, updated_at (timestamptz)

### shipment_tracking_events
- id (uuid PK), order_id (uuid FK CASCADE), status (tracking_event_type), title (text)
- description (text nullable), location (text nullable), created_by (uuid FK), created_at (timestamptz)

## Constraints & Indexes
- Unique on collaboration_id (no duplicate orders), unique on order_number
- Indexes on trip_id, sender_listing_id, traveler_id, sender_id, status, created_at
- Indexes on tracking_events order_id and created_at

## Triggers
1. order_set_updated_at — auto-update updated_at
2. guard_order_ownership — prevent changes to immutable fields
3. guard_order_status_transition — enforce valid state machine + auto-set timestamps
4. create_tracking_event_and_notify — create tracking event + notification on status change
5. guard_tracking_event_immutable — block UPDATE and DELETE on tracking events

## Functions
1. create_order_from_collaboration(p_collaboration_id) — SECURITY DEFINER, validates all relationships
2. is_admin() — already exists from Phase 5

## RLS Policies
### orders: SELECT (participant or admin), INSERT (blocked), UPDATE (participant or admin), DELETE (admin only)
### tracking_events: SELECT (participant or admin), INSERT/UPDATE/DELETE (all blocked)

## Notification types extended: order_created, order_confirmed, shipment_in_transit, shipment_delivered, receipt_confirmed, order_completed, order_cancelled

## Security
- Uses is_admin() SECURITY DEFINER (no recursion — fixed in Phase 5)
- All triggers/functions are SECURITY DEFINER with SET search_path TO 'public'
- Orders created only via create_order_from_collaboration() function
- Tracking events fully immutable
- Ownership fields locked after insert
*/

-- ============================================================
-- 1. ENUM TYPES
-- ============================================================

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'pending', 'confirmed', 'in_transit', 'delivered', 'received', 'completed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tracking_event_type AS ENUM (
    'order_created', 'order_confirmed', 'shipment_picked_up', 'shipment_in_transit',
    'shipment_delivered', 'receipt_confirmed', 'order_completed', 'order_cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. ADD NOTIFICATION TYPES
-- ============================================================

DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE 'order_created';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE 'order_confirmed';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE 'shipment_in_transit';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE 'shipment_delivered';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE 'receipt_confirmed';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE 'order_completed';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE 'order_cancelled';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 3. ORDERS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaboration_id uuid NOT NULL REFERENCES collaborations(id) ON DELETE RESTRICT,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE RESTRICT,
  sender_listing_id uuid NOT NULL REFERENCES sender_listings(id) ON DELETE RESTRICT,
  traveler_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  order_number text NOT NULL,
  status order_status NOT NULL DEFAULT 'pending',
  agreed_weight_kg numeric NOT NULL CHECK (agreed_weight_kg > 0),
  agreed_price numeric NOT NULL CHECK (agreed_price >= 0),
  platform_fee numeric NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  total_amount numeric NOT NULL CHECK (total_amount >= 0),
  currency text NOT NULL DEFAULT 'USD',
  pickup_location text,
  delivery_location text,
  expected_delivery_date date,
  sender_confirmed_at timestamptz,
  traveler_confirmed_at timestamptz,
  delivered_at timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_collaboration_id ON orders(collaboration_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_trip_id ON orders(trip_id);
CREATE INDEX IF NOT EXISTS idx_orders_sender_listing_id ON orders(sender_listing_id);
CREATE INDEX IF NOT EXISTS idx_orders_traveler_id ON orders(traveler_id);
CREATE INDEX IF NOT EXISTS idx_orders_sender_id ON orders(sender_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

-- ============================================================
-- 4. SHIPMENT TRACKING EVENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS shipment_tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status tracking_event_type NOT NULL,
  title text NOT NULL,
  description text,
  location text,
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_order_id ON shipment_tracking_events(order_id);
CREATE INDEX IF NOT EXISTS idx_tracking_events_created_at ON shipment_tracking_events(created_at);

-- ============================================================
-- 5. ENABLE RLS
-- ============================================================

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_tracking_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. RLS POLICIES — orders
-- ============================================================

DROP POLICY IF EXISTS "order_select" ON orders;
CREATE POLICY "order_select" ON orders FOR SELECT
  TO authenticated USING (
    auth.uid() = traveler_id OR auth.uid() = sender_id OR is_admin()
  );

DROP POLICY IF EXISTS "order_insert" ON orders;
CREATE POLICY "order_insert" ON orders FOR INSERT
  TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "order_update" ON orders;
CREATE POLICY "order_update" ON orders FOR UPDATE
  TO authenticated USING (
    auth.uid() = traveler_id OR auth.uid() = sender_id OR is_admin()
  ) WITH CHECK (
    auth.uid() = traveler_id OR auth.uid() = sender_id OR is_admin()
  );

DROP POLICY IF EXISTS "order_delete" ON orders;
CREATE POLICY "order_delete" ON orders FOR DELETE
  TO authenticated USING (is_admin());

-- ============================================================
-- 7. RLS POLICIES — shipment_tracking_events
-- ============================================================

DROP POLICY IF EXISTS "tracking_select" ON shipment_tracking_events;
CREATE POLICY "tracking_select" ON shipment_tracking_events FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = shipment_tracking_events.order_id
      AND (o.traveler_id = auth.uid() OR o.sender_id = auth.uid() OR is_admin())
    )
  );

DROP POLICY IF EXISTS "tracking_insert" ON shipment_tracking_events;
CREATE POLICY "tracking_insert" ON shipment_tracking_events FOR INSERT
  TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "tracking_update" ON shipment_tracking_events;
CREATE POLICY "tracking_update" ON shipment_tracking_events FOR UPDATE
  TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "tracking_delete" ON shipment_tracking_events;
CREATE POLICY "tracking_delete" ON shipment_tracking_events FOR DELETE
  TO authenticated USING (false);

-- ============================================================
-- 8. TRIGGERS — orders updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION order_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_updated_at ON orders;
CREATE TRIGGER order_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION order_set_updated_at();

-- ============================================================
-- 9. TRIGGERS — ownership guard
-- ============================================================

CREATE OR REPLACE FUNCTION guard_order_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.collaboration_id IS DISTINCT FROM OLD.collaboration_id THEN
    RAISE EXCEPTION 'Cannot change collaboration_id on an existing order';
  END IF;
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id THEN
    RAISE EXCEPTION 'Cannot change trip_id on an existing order';
  END IF;
  IF NEW.sender_listing_id IS DISTINCT FROM OLD.sender_listing_id THEN
    RAISE EXCEPTION 'Cannot change sender_listing_id on an existing order';
  END IF;
  IF NEW.traveler_id IS DISTINCT FROM OLD.traveler_id THEN
    RAISE EXCEPTION 'Cannot change traveler_id on an existing order';
  END IF;
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'Cannot change sender_id on an existing order';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Cannot change created_at on an existing order';
  END IF;
  IF NEW.order_number IS DISTINCT FROM OLD.order_number THEN
    RAISE EXCEPTION 'Cannot change order_number on an existing order';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_guard_ownership ON orders;
CREATE TRIGGER order_guard_ownership BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION guard_order_ownership();

-- ============================================================
-- 10. TRIGGERS — status transition guard with auto-timestamps
-- ============================================================

CREATE OR REPLACE FUNCTION guard_order_status_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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

  IF OLD.status = 'confirmed' AND NEW.status = 'in_transit' THEN
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

DROP TRIGGER IF EXISTS order_guard_status ON orders;
CREATE TRIGGER order_guard_status BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION guard_order_status_transition();

-- ============================================================
-- 11. TRACKING EVENT + NOTIFICATION TRIGGER (AFTER UPDATE)
-- ============================================================

CREATE OR REPLACE FUNCTION create_tracking_event_and_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
    WHEN 'confirmed' THEN
      v_event_status := 'order_confirmed';
      v_title := 'Order Confirmed';
      v_description := 'The traveler has confirmed the shipment order.';
      v_notify_user_id := NEW.sender_id;
      v_notify_type := 'order_confirmed';
      v_notify_title := 'Order Confirmed';
      v_notify_body := 'Your order has been confirmed by the traveler.';

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
  VALUES (NEW.id, v_event_status, v_title, v_description, NULL, auth.uid());

  IF v_notify_user_id IS NOT NULL AND v_notify_user_id <> auth.uid() THEN
    INSERT INTO notifications (user_id, type, title, body)
    VALUES (v_notify_user_id, v_notify_type, v_notify_title, v_notify_body);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_tracking_notify ON orders;
CREATE TRIGGER order_tracking_notify AFTER UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION create_tracking_event_and_notify();

-- ============================================================
-- 12. TRACKING EVENT IMMUTABILITY GUARD
-- ============================================================

CREATE OR REPLACE FUNCTION guard_tracking_event_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'Shipment tracking events are immutable and cannot be modified or deleted';
END;
$$;

DROP TRIGGER IF EXISTS tracking_no_update ON shipment_tracking_events;
CREATE TRIGGER tracking_no_update BEFORE UPDATE ON shipment_tracking_events
  FOR EACH ROW EXECUTE FUNCTION guard_tracking_event_immutable();

DROP TRIGGER IF EXISTS tracking_no_delete ON shipment_tracking_events;
CREATE TRIGGER tracking_no_delete BEFORE DELETE ON shipment_tracking_events
  FOR EACH ROW EXECUTE FUNCTION guard_tracking_event_immutable();

-- ============================================================
-- 13. ORDER CREATION FUNCTION (SECURITY DEFINER)
-- ============================================================

CREATE OR REPLACE FUNCTION create_order_from_collaboration(p_collaboration_id uuid)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  v_platform_fee := LEAST(v_agreed_price * 0.05, 50);
  v_total := v_agreed_price + v_platform_fee;

  v_order_number := 'ORD-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substring(encode(gen_random_bytes(4), 'hex') from 1 for 6));

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

GRANT EXECUTE ON FUNCTION create_order_from_collaboration(uuid) TO authenticated;
GRANT SELECT, UPDATE ON orders TO authenticated;
GRANT SELECT ON shipment_tracking_events TO authenticated;
