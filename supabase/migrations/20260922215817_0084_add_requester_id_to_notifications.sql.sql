/*
# Fix: Store requester_id in admin action notifications

## Problem
The `create_admin_action_notification` function receives `p_requester_id`
but never stores it. The `notifications` table has no column for it.
The AdminNotifications frontend page tries to look up the requester's
profile using `notif.user_id`, but `user_id` is the admin's own ID
(not the requester's), so the admin sees their own name instead of
the requester's name.

## Fix
1. Add `requester_id` column (nullable uuid) to `notifications`.
2. Update `create_admin_action_notification` to store `p_requester_id`
   in the new `requester_id` column.
3. The frontend will use `requester_id` to look up the requester's profile.

## Security
- New column is nullable, no impact on existing rows.
- No new policies needed (requester_id is only read by admins who already
  have SELECT access to admin action notifications via is_admin()).
- No data migration needed (existing notifications will have NULL requester_id).
*/

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS requester_id uuid;

CREATE OR REPLACE FUNCTION public.create_admin_action_notification(
  p_entity_type text,
  p_entity_id uuid,
  p_notification_type notification_type,
  p_title text,
  p_body text,
  p_requester_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id, is_read, requester_id)
  SELECT id, p_notification_type, p_title, p_body, p_entity_type, p_entity_id, false, p_requester_id
  FROM profiles WHERE role = 'admin'
  ON CONFLICT DO NOTHING;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_admin_action_notification FROM PUBLIC, anon;
