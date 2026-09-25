/*
# AL-WAZN Phase 3: Traveler & Sender Marketplace

## Purpose
Creates the marketplace foundation: trips (travelers) and sender_listings (senders).
Enforces role-based creation, verification gating, ownership protection, status
transition rules, and public/private visibility — all at the database level.

## 1. Enums
- `trip_status`: draft | published | in_progress | completed | cancelled
- `listing_status`: draft | published | matched | completed | cancelled

## 2. Tables

### trips
- traveler_id → profiles.id (ON DELETE CASCADE)
- origin, destination (text, NOT NULL)
- departure_date, arrival_date (date, NOT NULL, departure <= arrival)
- available_weight_kg (numeric, > 0)
- price_per_kg (numeric, >= 0)
- notes (text, nullable)
- status (trip_status, default 'draft')

### sender_listings
- sender_id → profiles.id (ON DELETE CASCADE)
- product_name, description (text, NOT NULL)
- quantity (integer, > 0)
- weight_kg (numeric, > 0)
- origin, destination (text, NOT NULL)
- preferred_date (date, nullable)
- budget (numeric, >= 0, nullable)
- notes (text, nullable)
- status (listing_status, default 'draft')

## 3. Helper Functions
- `is_verified_active_traveler()` — true if caller is traveler, verified, active
- `is_verified_active_sender()` — true if caller is sender, verified, active
- `is_admin()` — reused from Phase 1

## 4. Status Transition Triggers
- `guard_trip_status_transition()` — enforces valid transitions + verification for publish
- `guard_listing_status_transition()` — same for sender_listings
- `guard_trip_ownership()` — prevents traveler_id changes
- `guard_listing_ownership()` — prevents sender_id changes

## 5. RLS Policies

### trips
- SELECT: owner sees own; admin sees all; others see published only
- INSERT: verified active traveler, traveler_id = auth.uid()
- UPDATE: owner/admin, WITH CHECK prevents ownership change + unauthorized publish
- DELETE: owner/admin

### sender_listings
- SELECT: owner sees own; admin sees all; others see published only
- INSERT: verified active sender, sender_id = auth.uid()
- UPDATE: owner/admin, WITH CHECK prevents ownership change + unauthorized publish
- DELETE: owner/admin

## 6. Security
- Role enforcement: only travelers create trips, only senders create listings
- Verification gating: unverified/pending/rejected/suspended users cannot publish
- Ownership: traveler_id/sender_id cannot be changed after creation
- Public visibility: only published records visible to non-owners
- Status transitions: enforced at trigger level, not just frontend
*/

-- ============================================================
-- 1. ENUMS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE trip_status AS ENUM ('draft', 'published', 'in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE listing_status AS ENUM ('draft', 'published', 'matched', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION is_verified_active_traveler()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'traveler'
      AND verification_status = 'approved'
      AND identity_verified = true
      AND account_status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION is_verified_active_sender()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'sender'
      AND verification_status = 'approved'
      AND identity_verified = true
      AND account_status = 'active'
  );
$$;

-- ============================================================
-- 3. TRIPS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  traveler_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  origin text NOT NULL,
  destination text NOT NULL,
  departure_date date NOT NULL,
  arrival_date date NOT NULL,
  available_weight_kg numeric NOT NULL,
  price_per_kg numeric NOT NULL DEFAULT 0,
  notes text,
  status trip_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trips_weight_positive CHECK (available_weight_kg > 0),
  CONSTRAINT trips_price_non_negative CHECK (price_per_kg >= 0),
  CONSTRAINT trips_departure_before_arrival CHECK (departure_date <= arrival_date),
  CONSTRAINT trips_origin_not_empty CHECK (char_length(trim(origin)) > 0),
  CONSTRAINT trips_destination_not_empty CHECK (char_length(trim(destination)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_trips_traveler_id ON trips (traveler_id);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips (status);
CREATE INDEX IF NOT EXISTS idx_trips_origin ON trips (origin);
CREATE INDEX IF NOT EXISTS idx_trips_destination ON trips (destination);
CREATE INDEX IF NOT EXISTS idx_trips_departure_date ON trips (departure_date);
CREATE INDEX IF NOT EXISTS idx_trips_created_at ON trips (created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION trips_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_updated_at ON trips;
CREATE TRIGGER trips_updated_at
  BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION trips_set_updated_at();

-- Ownership guard: prevent traveler_id changes
CREATE OR REPLACE FUNCTION guard_trip_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.traveler_id <> OLD.traveler_id THEN
    RAISE EXCEPTION 'Cannot change trip ownership';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_guard_ownership ON trips;
CREATE TRIGGER trips_guard_ownership
  BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION guard_trip_ownership();

REVOKE EXECUTE ON FUNCTION guard_trip_ownership() FROM PUBLIC, anon, authenticated;

-- Status transition guard
CREATE OR REPLACE FUNCTION guard_trip_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only check if status is changing
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Define valid transitions
  IF OLD.status = 'draft' AND NEW.status = 'published' THEN
    -- Publishing requires verified active traveler
    IF NOT public.is_verified_active_traveler() THEN
      RAISE EXCEPTION 'Verification required to publish trips';
    END IF;
    RETURN NEW;
  ELSIF OLD.status = 'draft' AND NEW.status = 'cancelled' THEN
    RETURN NEW;
  ELSIF OLD.status = 'published' AND NEW.status = 'in_progress' THEN
    RETURN NEW;
  ELSIF OLD.status = 'published' AND NEW.status = 'cancelled' THEN
    RETURN NEW;
  ELSIF OLD.status = 'in_progress' AND NEW.status = 'completed' THEN
    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'Invalid trip status transition: % to %', OLD.status, NEW.status;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trips_guard_status ON trips;
CREATE TRIGGER trips_guard_status
  BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION guard_trip_status_transition();

REVOKE EXECUTE ON FUNCTION guard_trip_status_transition() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4. SENDER_LISTINGS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS sender_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL,
  weight_kg numeric NOT NULL,
  origin text NOT NULL,
  destination text NOT NULL,
  preferred_date date,
  budget numeric,
  notes text,
  status listing_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sl_quantity_positive CHECK (quantity > 0),
  CONSTRAINT sl_weight_positive CHECK (weight_kg > 0),
  CONSTRAINT sl_budget_non_negative CHECK (budget IS NULL OR budget >= 0),
  CONSTRAINT sl_product_name_not_empty CHECK (char_length(trim(product_name)) > 0),
  CONSTRAINT sl_description_not_empty CHECK (char_length(trim(description)) > 0),
  CONSTRAINT sl_origin_not_empty CHECK (char_length(trim(origin)) > 0),
  CONSTRAINT sl_destination_not_empty CHECK (char_length(trim(destination)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_sl_sender_id ON sender_listings (sender_id);
CREATE INDEX IF NOT EXISTS idx_sl_status ON sender_listings (status);
CREATE INDEX IF NOT EXISTS idx_sl_origin ON sender_listings (origin);
CREATE INDEX IF NOT EXISTS idx_sl_destination ON sender_listings (destination);
CREATE INDEX IF NOT EXISTS idx_sl_preferred_date ON sender_listings (preferred_date);
CREATE INDEX IF NOT EXISTS idx_sl_created_at ON sender_listings (created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION sl_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sl_updated_at ON sender_listings;
CREATE TRIGGER sl_updated_at
  BEFORE UPDATE ON sender_listings
  FOR EACH ROW EXECUTE FUNCTION sl_set_updated_at();

-- Ownership guard
CREATE OR REPLACE FUNCTION guard_listing_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_id <> OLD.sender_id THEN
    RAISE EXCEPTION 'Cannot change listing ownership';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sl_guard_ownership ON sender_listings;
CREATE TRIGGER sl_guard_ownership
  BEFORE UPDATE ON sender_listings
  FOR EACH ROW EXECUTE FUNCTION guard_listing_ownership();

REVOKE EXECUTE ON FUNCTION guard_listing_ownership() FROM PUBLIC, anon, authenticated;

-- Status transition guard
CREATE OR REPLACE FUNCTION guard_listing_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'published' THEN
    IF NOT public.is_verified_active_sender() THEN
      RAISE EXCEPTION 'Verification required to publish listings';
    END IF;
    RETURN NEW;
  ELSIF OLD.status = 'draft' AND NEW.status = 'cancelled' THEN
    RETURN NEW;
  ELSIF OLD.status = 'published' AND NEW.status = 'matched' THEN
    RETURN NEW;
  ELSIF OLD.status = 'published' AND NEW.status = 'cancelled' THEN
    RETURN NEW;
  ELSIF OLD.status = 'matched' AND NEW.status = 'completed' THEN
    RETURN NEW;
  ELSIF OLD.status = 'matched' AND NEW.status = 'cancelled' THEN
    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'Invalid listing status transition: % to %', OLD.status, NEW.status;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS sl_guard_status ON sender_listings;
CREATE TRIGGER sl_guard_status
  BEFORE UPDATE ON sender_listings
  FOR EACH ROW EXECUTE FUNCTION guard_listing_status_transition();

REVOKE EXECUTE ON FUNCTION guard_listing_status_transition() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 5. RLS ON TRIPS
-- ============================================================

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

-- SELECT: owner sees own, admin sees all, others see published only
DROP POLICY IF EXISTS "trips_select" ON trips;
CREATE POLICY "trips_select"
ON trips FOR SELECT
TO anon, authenticated
USING (
  auth.uid() = traveler_id
  OR public.is_admin()
  OR status = 'published'
);

-- INSERT: verified active traveler, own traveler_id
DROP POLICY IF EXISTS "trips_insert" ON trips;
CREATE POLICY "trips_insert"
ON trips FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = traveler_id
  AND public.is_verified_active_traveler()
);

-- UPDATE: owner/admin, prevent ownership change, prevent unauthorized publish
DROP POLICY IF EXISTS "trips_update" ON trips;
CREATE POLICY "trips_update"
ON trips FOR UPDATE
TO authenticated
USING (
  auth.uid() = traveler_id
  OR public.is_admin()
)
WITH CHECK (
  auth.uid() = traveler_id
  OR public.is_admin()
);

-- DELETE: owner/admin
DROP POLICY IF EXISTS "trips_delete" ON trips;
CREATE POLICY "trips_delete"
ON trips FOR DELETE
TO authenticated
USING (
  auth.uid() = traveler_id
  OR public.is_admin()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON trips TO authenticated;
GRANT SELECT ON trips TO anon;

-- ============================================================
-- 6. RLS ON SENDER_LISTINGS
-- ============================================================

ALTER TABLE sender_listings ENABLE ROW LEVEL SECURITY;

-- SELECT: owner sees own, admin sees all, others see published only
DROP POLICY IF EXISTS "sl_select" ON sender_listings;
CREATE POLICY "sl_select"
ON sender_listings FOR SELECT
TO anon, authenticated
USING (
  auth.uid() = sender_id
  OR public.is_admin()
  OR status = 'published'
);

-- INSERT: verified active sender, own sender_id
DROP POLICY IF EXISTS "sl_insert" ON sender_listings;
CREATE POLICY "sl_insert"
ON sender_listings FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = sender_id
  AND public.is_verified_active_sender()
);

-- UPDATE: owner/admin, prevent ownership change, prevent unauthorized publish
DROP POLICY IF EXISTS "sl_update" ON sender_listings;
CREATE POLICY "sl_update"
ON sender_listings FOR UPDATE
TO authenticated
USING (
  auth.uid() = sender_id
  OR public.is_admin()
)
WITH CHECK (
  auth.uid() = sender_id
  OR public.is_admin()
);

-- DELETE: owner/admin
DROP POLICY IF EXISTS "sl_delete" ON sender_listings;
CREATE POLICY "sl_delete"
ON sender_listings FOR DELETE
TO authenticated
USING (
  auth.uid() = sender_id
  OR public.is_admin()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON sender_listings TO authenticated;
GRANT SELECT ON sender_listings TO anon;
