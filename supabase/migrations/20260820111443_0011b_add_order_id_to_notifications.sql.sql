/*
# Add related_order_id to notifications table

## Changes
- Adds `related_order_id` column to `notifications` table
- Links notifications to orders for payment and order-related notifications
*/

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS related_order_id uuid REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_related_order_id ON notifications(related_order_id) WHERE related_order_id IS NOT NULL;
