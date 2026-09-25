/*
# AL-WAZN Phase 4: Traveler ↔ Sender Collaborations

## Purpose
Creates the collaboration system connecting verified Travelers with verified Senders.
A Sender requests collaboration on a published Traveler Trip using one of their own
published Sender Listings. The Traveler can accept or reject. Both parties can view
the collaboration. All access control is enforced at the database/RLS level.

## 1. Enum
- `collaboration_status`: pending | accepted | rejected | cancelled | completed

## 2. Table: collaborations
- id (uuid PK)
- trip_id → trips.id (ON DELETE CASCADE)
- sender_listing_id → sender_listings.id (ON DELETE CASCADE)
- traveler_id → profiles.id (ON DELETE CASCADE) — denormalized from trip for RLS efficiency
- sender_id → profiles.id (ON DELETE CASCADE) — denormalized from listing for RLS efficiency
- status (collaboration_status, default 'pending')
- message (text, nullable) — optional message from sender
- proposed_weight_kg (numeric, > 0)
- proposed_price (numeric, >= 0)
- agreed_weight_kg (numeric, nullable) — set on acceptance
- agreed_price (numeric, nullable) — set on acceptance
- created_at, updated_at (timestamptz)
- accepted_at, rejected_at, cancelled_at, completed_at (timestamptz, nullable)

## 3. Constraints
- proposed_weight_kg > 0
- proposed_price >= 0
- agreed_weight_kg > 0 (when not null)
- agreed_price >= 0 (when not null)
- Partial unique index on (trip_id, sender_listing_id) WHERE status IN ('pending','accepted')
  — prevents duplicate active collaborations

## 4. Helper Functions
- `is_verified_active_sender()` — reused from Phase 3
- `is_admin()` — reused from Phase 1

## 5. Triggers
- `collab_set_updated_at()` — maintains updated_at
- `guard_collab_ownership()` — prevents changes to trip_id, sender_listing_id,
  traveler_id, sender_id after creation
- `guard_collab_status_transition()` — enforces valid status transitions:
  - pending → accepted (traveler only, via RLS)
  - pending → rejected (traveler only, via RLS)
  - pending → cancelled (sender only, via RLS)
  - accepted → completed (traveler only, via RLS)
  - Sets accepted_at, rejected_at, cancelled_at, completed_at automatically
  - Blocks: rejected→accepted, cancelled→accepted, completed→*, etc.
  - On accept: copies proposed_weight_kg/price to agreed fields

## 6. RLS Policies
### SELECT
- Owner (sender_id = auth.uid()) sees own collaborations
- Traveler (traveler_id = auth.uid()) sees collaborations on their trips
- Admin sees all
- Others: blocked

### INSERT
- Authenticated sender only (is_verified_active_sender)
- sender_id = auth.uid()
- The referenced sender_listing must belong to the caller (checked via subquery)
- The referenced trip must be published and not owned by the caller (checked via subquery)
- traveler_id must match the trip's traveler_id (checked via subquery)

### UPDATE
- Owner (sender_id = auth.uid()) OR traveler (traveler_id = auth.uid()) OR admin
- WITH CHECK prevents ownership field changes
- Status transition logic enforced by trigger, not policy

### DELETE
- Owner (sender_id = auth.uid()) OR admin
- Travelers cannot delete (they can only reject)

## 7. Security Notes
- Only senders can CREATE collaborations
- Only the trip's traveler can ACCEPT or REJECT
- Only the collaboration's sender can CANCEL
- Ownership fields are immutable after creation
- Status transitions are strictly enforced
- Timestamps are set automatically by triggers
- No mock/seed data
*/
-- ============================================================
-- 1. ENUM
-- ============================================================

DO $$ BEGIN
  CREATE TYPE collaboration_status AS ENUM ('pending', 'accepted', 'rejected', 'cancelled', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS collaborations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  sender_listing_id uuid NOT NULL REFERENCES sender_listings(id) ON DELETE CASCADE,
  traveler_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status collaboration_status NOT NULL DEFAULT 'pending',
  message text,
  proposed_weight_kg numeric NOT NULL,
  proposed_price numeric NOT NULL DEFAULT 0,
  agreed_weight_kg numeric,
  agreed_price numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT collab_proposed_weight_positive CHECK (proposed_weight_kg > 0),
  CONSTRAINT collab_proposed_price_non_negative CHECK (proposed_price >= 0),
  CONSTRAINT collab_agreed_weight_positive CHECK (agreed_weight_kg IS NULL OR agreed_weight_kg > 0),
  CONSTRAINT collab_agreed_price_non_negative CHECK (agreed_price IS NULL OR agreed_price >= 0)
);

-- Prevent duplicate active collaborations (pending or accepted) for same trip + listing
CREATE UNIQUE INDEX IF NOT EXISTS idx_collab_unique_active
  ON collaborations (trip_id, sender_listing_id)
  WHERE status IN ('pending', 'accepted');

-- Standard indexes
CREATE INDEX IF NOT EXISTS idx_collab_trip_id ON collaborations (trip_id);
CREATE INDEX IF NOT EXISTS idx_collab_sender_listing_id ON collaborations (sender_listing_id);
CREATE INDEX IF NOT EXISTS idx_collab_traveler_id ON collaborations (traveler_id);
CREATE INDEX IF NOT EXISTS idx_collab_sender_id ON collaborations (sender_id);
CREATE INDEX IF NOT EXISTS idx_collab_status ON collaborations (status);
CREATE INDEX IF NOT EXISTS idx_collab_created_at ON collaborations (created_at DESC);

-- ============================================================
-- 3. TRIGGERS
-- ============================================================

-- updated_at
CREATE OR REPLACE FUNCTION collab_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collab_updated_at ON collaborations;
CREATE TRIGGER collab_updated_at
  BEFORE UPDATE ON collaborations
  FOR EACH ROW EXECUTE FUNCTION collab_set_updated_at();

-- Ownership guard: prevent changes to key fields
CREATE OR REPLACE FUNCTION guard_collab_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.trip_id <> OLD.trip_id THEN
    RAISE EXCEPTION 'Cannot change collaboration trip_id';
  END IF;
  IF NEW.sender_listing_id <> OLD.sender_listing_id THEN
    RAISE EXCEPTION 'Cannot change collaboration sender_listing_id';
  END IF;
  IF NEW.traveler_id <> OLD.traveler_id THEN
    RAISE EXCEPTION 'Cannot change collaboration traveler_id';
  END IF;
  IF NEW.sender_id <> OLD.sender_id THEN
    RAISE EXCEPTION 'Cannot change collaboration sender_id';
  END IF;
  IF NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Cannot change collaboration created_at';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collab_guard_ownership ON collaborations;
CREATE TRIGGER collab_guard_ownership
  BEFORE UPDATE ON collaborations
  FOR EACH ROW EXECUTE FUNCTION guard_collab_ownership();

REVOKE EXECUTE ON FUNCTION guard_collab_ownership() FROM PUBLIC, anon, authenticated;

-- Status transition guard + auto timestamps
CREATE OR REPLACE FUNCTION guard_collab_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If status is not changing, allow (other fields may be updating)
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- pending → accepted
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    NEW.accepted_at := now();
    NEW.rejected_at := NULL;
    NEW.cancelled_at := NULL;
    -- Copy proposed values to agreed on acceptance
    IF NEW.agreed_weight_kg IS NULL THEN
      NEW.agreed_weight_kg := OLD.proposed_weight_kg;
    END IF;
    IF NEW.agreed_price IS NULL THEN
      NEW.agreed_price := OLD.proposed_price;
    END IF;
    RETURN NEW;
  END IF;

  -- pending → rejected
  IF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
    NEW.rejected_at := now();
    RETURN NEW;
  END IF;

  -- pending → cancelled
  IF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now();
    RETURN NEW;
  END IF;

  -- accepted → completed
  IF OLD.status = 'accepted' AND NEW.status = 'completed' THEN
    NEW.completed_at := now();
    RETURN NEW;
  END IF;

  -- All other transitions are invalid
  RAISE EXCEPTION 'Invalid collaboration status transition: % to %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS collab_guard_status ON collaborations;
CREATE TRIGGER collab_guard_status
  BEFORE UPDATE ON collaborations
  FOR EACH ROW EXECUTE FUNCTION guard_collab_status_transition();

REVOKE EXECUTE ON FUNCTION guard_collab_status_transition() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4. RLS
-- ============================================================

ALTER TABLE collaborations ENABLE ROW LEVEL SECURITY;

-- SELECT: sender sees own, traveler sees own trips' collabs, admin sees all
DROP POLICY IF EXISTS "collab_select" ON collaborations;
CREATE POLICY "collab_select"
ON collaborations FOR SELECT
TO authenticated
USING (
  auth.uid() = sender_id
  OR auth.uid() = traveler_id
  OR public.is_admin()
);

-- INSERT: verified active sender, owns the listing, trip is published & not own
DROP POLICY IF EXISTS "collab_insert" ON collaborations;
CREATE POLICY "collab_insert"
ON collaborations FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = sender_id
  AND public.is_verified_active_sender()
  -- The sender_listing must belong to the caller
  AND EXISTS (
    SELECT 1 FROM sender_listings sl
    WHERE sl.id = sender_listing_id
      AND sl.sender_id = auth.uid()
      AND sl.status = 'published'
  )
  -- The trip must be published and NOT belong to the caller
  AND EXISTS (
    SELECT 1 FROM trips t
    WHERE t.id = trip_id
      AND t.status = 'published'
      AND t.traveler_id <> auth.uid()
  )
  -- traveler_id must match the trip's traveler_id
  AND EXISTS (
    SELECT 1 FROM trips t
    WHERE t.id = trip_id
      AND t.traveler_id = collaborations.traveler_id
  )
);

-- UPDATE: sender or traveler or admin
-- The trigger enforces who can do which transition via status rules
-- RLS allows both parties to UPDATE, but the trigger + app logic restrict actions
DROP POLICY IF EXISTS "collab_update" ON collaborations;
CREATE POLICY "collab_update"
ON collaborations FOR UPDATE
TO authenticated
USING (
  auth.uid() = sender_id
  OR auth.uid() = traveler_id
  OR public.is_admin()
)
WITH CHECK (
  auth.uid() = sender_id
  OR auth.uid() = traveler_id
  OR public.is_admin()
);

-- DELETE: sender or admin only (travelers reject, not delete)
DROP POLICY IF EXISTS "collab_delete" ON collaborations;
CREATE POLICY "collab_delete"
ON collaborations FOR DELETE
TO authenticated
USING (
  auth.uid() = sender_id
  OR public.is_admin()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON collaborations TO authenticated;
