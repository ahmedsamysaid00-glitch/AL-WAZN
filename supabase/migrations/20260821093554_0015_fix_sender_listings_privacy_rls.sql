-- Fix sender_listings RLS policies for sender privacy and marketplace visibility.
--
-- ROOT CAUSE: The sl_select policy allowed ANY authenticated user to SELECT
-- published listings, including other senders. The condition
-- (status = 'published') had no role check, so Sender B could see
-- Sender A's published shipments.
--
-- NEW SELECT RULE:
--   1. Owner (auth.uid() = sender_id) — see own listings regardless of status
--   2. Verified/active traveler (is_verified_active_traveler()) — see only published listings
--   3. Admin (is_admin()) — see all listings
--   Other senders: never see another sender's listings.
--
-- NEW UPDATE RULE:
--   Only owner (auth.uid() = sender_id) or admin.
--   WITH CHECK also enforces ownership (sender_id cannot change — trigger handles this too).
--
-- NEW DELETE RULE:
--   Only owner (auth.uid() = sender_id) or admin.

-- Drop existing policies
DROP POLICY IF EXISTS sl_select ON public.sender_listings;
DROP POLICY IF EXISTS sl_insert ON public.sender_listings;
DROP POLICY IF EXISTS sl_update ON public.sender_listings;
DROP POLICY IF EXISTS sl_delete ON public.sender_listings;

-- SELECT: owner sees own (any status); verified traveler sees published only; admin sees all
CREATE POLICY sl_select_own ON public.sender_listings
  FOR SELECT TO authenticated
  USING (auth.uid() = sender_id);

CREATE POLICY sl_select_traveler_marketplace ON public.sender_listings
  FOR SELECT TO authenticated
  USING (is_verified_active_traveler() AND status = 'published');

CREATE POLICY sl_select_admin ON public.sender_listings
  FOR SELECT TO authenticated
  USING (is_admin());

-- INSERT: only verified active senders, must own the listing
CREATE POLICY sl_insert_own ON public.sender_listings
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id AND is_verified_active_sender());

-- UPDATE: only owner or admin; WITH CHECK enforces ownership stays the same
CREATE POLICY sl_update_own ON public.sender_listings
  FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id)
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY sl_update_admin ON public.sender_listings
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- DELETE: only owner or admin
CREATE POLICY sl_delete_own ON public.sender_listings
  FOR DELETE TO authenticated
  USING (auth.uid() = sender_id);

CREATE POLICY sl_delete_admin ON public.sender_listings
  FOR DELETE TO authenticated
  USING (is_admin());
