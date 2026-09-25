/*
# Fix Orders FK Constraints for Admin User Deletion

## Root Cause
The `admin_delete_user` RPC deletes from `auth.users`, which CASCADEs to `profiles`.
When a user has collaborations, the profile deletion CASCADEs to collaborations.
But if an accepted collaboration has an order, the `orders.collaboration_id` FK is
`ON DELETE RESTRICT`, blocking the collaboration deletion, which blocks the profile
deletion, which blocks the auth.users deletion.

Similarly, `orders.trip_id` and `orders.sender_listing_id` are `ON DELETE RESTRICT`,
which blocks deletion of trips and sender_listings that belong to the deleted user
when an order references them.

## Fix
1. Change `orders.collaboration_id` FK from RESTRICT to SET NULL — orders are
   financial records that must be preserved for accounting; the collaboration
   link is set to NULL but the order record (amount, status, timestamps) is kept.
2. Change `orders.trip_id` FK from RESTRICT to SET NULL — same principle.
3. Change `orders.sender_listing_id` FK from RESTRICT to SET NULL — same principle.
4. Make `orders.collaboration_id`, `orders.trip_id`, `orders.sender_listing_id`
   nullable (they are currently NOT NULL, which would prevent SET NULL from working).

## Security
No RLS changes. No grant changes. Only FK constraint behavior changes to allow
user deletion while preserving financial/order records.
*/

-- 1. Make order reference columns nullable (required for SET NULL to work)
ALTER TABLE orders ALTER COLUMN collaboration_id DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN trip_id DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN sender_listing_id DROP NOT NULL;

-- 2. Change FK constraints from RESTRICT to SET NULL
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_collaboration_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_collaboration_id_fkey
  FOREIGN KEY (collaboration_id) REFERENCES collaborations(id) ON DELETE SET NULL;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_trip_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_trip_id_fkey
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_sender_listing_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_sender_listing_id_fkey
  FOREIGN KEY (sender_listing_id) REFERENCES sender_listings(id) ON DELETE SET NULL;
