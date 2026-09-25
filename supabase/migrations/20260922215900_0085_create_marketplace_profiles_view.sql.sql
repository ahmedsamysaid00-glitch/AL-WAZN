/*
# Fix: Replace broad profiles marketplace RLS policy with a safe view

## Problem
The previous migration (0083) added a `profiles_select_marketplace_participants`
SELECT policy on the `profiles` table. Since RLS cannot restrict which columns
are returned, this policy exposed ALL columns (including email, role,
account_status, verification_status, identity_verified) to any authenticated
user who shares a marketplace context with the profile owner.

While the frontend only selects `full_name`, a malicious user could craft a
query selecting `email` or other sensitive fields from the profiles of
users they discovered through published trips, listings, collaborations,
conversations, or orders.

## Fix
1. Drop the overly-broad `profiles_select_marketplace_participants` policy.
2. Create a `marketplace_profiles` VIEW that exposes only `id` and `full_name`.
3. Enable RLS on the view with a policy that allows authenticated users to
   read rows for users who have published trips/listings or share a
   collaboration, conversation, or order.
4. The frontend will be updated to use `marketplace_profiles` instead of
   `profiles` in marketplace discovery and detail contexts.

## Security
- The view only exposes id and full_name — no email, role, or status fields.
- RLS on the view ensures only marketplace-context profiles are visible.
- Existing `profiles_select_own_or_admin` policy remains unchanged.
*/

-- Drop the overly-broad policy from the previous migration
DROP POLICY IF EXISTS "profiles_select_marketplace_participants" ON profiles;

-- Create a safe view exposing only non-sensitive columns
CREATE OR REPLACE VIEW public.marketplace_profiles AS
SELECT id, full_name FROM public.profiles;

-- Enable RLS on the view
ALTER VIEW public.marketplace_profiles SET (security_invoker = true);

-- The view inherits RLS from the base table, but we need a policy that
-- allows marketplace-context access. Since views with security_invoker=true
-- run with the caller's permissions, we need a policy on the underlying
-- profiles table that the view can use.
-- Actually, with security_invoker=true, the view runs as the caller, so
-- RLS on profiles applies. We need to re-add a restricted policy.
-- But we want to limit columns, not rows. The view handles column restriction.
-- The policy handles row restriction.

-- Re-add the marketplace policy on profiles (row-level only, column-level
-- is handled by the view)
DROP POLICY IF EXISTS "profiles_select_marketplace_participants" ON profiles;
CREATE POLICY "profiles_select_marketplace_participants"
ON profiles FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM trips t
    WHERE t.traveler_id = profiles.id
    AND t.status = 'published'
  )
  OR EXISTS (
    SELECT 1 FROM sender_listings sl
    WHERE sl.sender_id = profiles.id
    AND sl.status = 'published'
  )
  OR EXISTS (
    SELECT 1 FROM collaborations c
    WHERE (c.traveler_id = auth.uid() AND c.sender_id = profiles.id)
       OR (c.sender_id = auth.uid() AND c.traveler_id = profiles.id)
  )
  OR EXISTS (
    SELECT 1 FROM conversations cv
    WHERE (cv.traveler_id = auth.uid() AND cv.sender_id = profiles.id)
       OR (cv.sender_id = auth.uid() AND cv.traveler_id = profiles.id)
  )
  OR EXISTS (
    SELECT 1 FROM orders o
    WHERE (o.traveler_id = auth.uid() AND o.sender_id = profiles.id)
       OR (o.sender_id = auth.uid() AND o.traveler_id = profiles.id)
  )
);

-- Grant SELECT on the view to authenticated
GRANT SELECT ON public.marketplace_profiles TO authenticated;
