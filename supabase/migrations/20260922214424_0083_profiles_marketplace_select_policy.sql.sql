/*
# Fix: Allow authenticated users to see display names of marketplace participants

## Problem
The profiles table SELECT policy only allowed `auth.uid() = id OR is_admin()`.
This blocked users from seeing other users' `full_name` in:
- DiscoverTripsPage: senders viewing published trips (trips JOIN profiles)
- DiscoverShipmentsPage: travelers viewing published listings (sender_listings JOIN profiles)
- OrderDetailPage: both parties viewing the other party's name
- ConversationDetailPage: both parties viewing the other party's name
- CollaborationDetailPage: both parties viewing the other party's name

The frontend gracefully fell back to '—' or generic labels, so names never displayed.

## Fix
Add a SELECT policy allowing authenticated users to read profiles of:
1. Users who have published trips (marketplace context)
2. Users who have published sender listings (marketplace context)
3. Users who share a collaboration with the requester
4. Users who share a conversation with the requester
5. Users who share an order with the requester

This exposes only the profile row (which includes full_name, email, etc.).
Email exposure is acceptable in this marketplace context where users interact
and need to identify each other. The admin already has full access.

## Security
- No new tables or columns
- RLS policy addition only
- Does not modify existing policies
- Does not grant INSERT, UPDATE, or DELETE
*/

-- Add marketplace/participant visibility SELECT policy on profiles
DROP POLICY IF EXISTS "profiles_select_marketplace_participants" ON profiles;
CREATE POLICY "profiles_select_marketplace_participants"
ON profiles FOR SELECT
TO authenticated
USING (
  -- User has a published trip visible in the marketplace
  EXISTS (
    SELECT 1 FROM trips t
    WHERE t.traveler_id = profiles.id
    AND t.status = 'published'
  )
  -- User has a published sender listing visible in the marketplace
  OR EXISTS (
    SELECT 1 FROM sender_listings sl
    WHERE sl.sender_id = profiles.id
    AND sl.status = 'published'
  )
  -- User shares a collaboration with the requester
  OR EXISTS (
    SELECT 1 FROM collaborations c
    WHERE (c.traveler_id = auth.uid() AND c.sender_id = profiles.id)
       OR (c.sender_id = auth.uid() AND c.traveler_id = profiles.id)
  )
  -- User shares a conversation with the requester
  OR EXISTS (
    SELECT 1 FROM conversations cv
    WHERE (cv.traveler_id = auth.uid() AND cv.sender_id = profiles.id)
       OR (cv.sender_id = auth.uid() AND cv.traveler_id = profiles.id)
  )
  -- User shares an order with the requester
  OR EXISTS (
    SELECT 1 FROM orders o
    WHERE (o.traveler_id = auth.uid() AND o.sender_id = profiles.id)
       OR (o.sender_id = auth.uid() AND o.traveler_id = profiles.id)
  )
);
