/*
# Real-time, Admin Message Deletion, and Notification Ownership Fix

## Purpose
1. Add `message_deleted` to the audit_action enum for logging admin message deletions.
2. Create `admin_delete_message(p_message_id uuid)` RPC for secure admin-only message deletion with audit logging.
3. Fix the `notif_delete` RLS policy on `notifications` — currently is_admin() only, which is backwards.
   Users must be able to delete their OWN notifications. Admin can only delete their own notifications too.
4. Add tables to the `supabase_realtime` publication so Postgres Changes work for messages, notifications,
   collaborations, orders, trips, and sender_listings.

## Modified Tables
- `notifications` — RLS DELETE policy changed from `is_admin()` to `auth.uid() = user_id` (owner-only).

## New RPCs
- `admin_delete_message(p_message_id uuid)` — SECURITY DEFINER, verifies admin, verifies message exists,
  deletes the message, logs to audit_logs. Only deletes the single message row.

## Realtime
- Adds `messages`, `notifications`, `collaborations`, `orders`, `trips`, `sender_listings`,
  `conversations` to the `supabase_realtime` publication.

## Security Changes
- `notif_delete` policy: changed from `is_admin()` to `auth.uid() = user_id`.
  This means: users can delete ONLY their own notifications. Admin can delete ONLY their own notifications.
  Admin CANNOT delete other users' notifications through the normal delete flow.
- `admin_delete_message` RPC: requires auth, verifies is_admin(), deletes only the specified message.
- Audit log: records admin_id, entity_id (message_id), entity_type='message', action='message_deleted',
  and stores conversation_id and sender_id in the reason field for traceability.

## Important Notes
1. The existing `msg_delete` policy on messages (`is_admin()`) remains — it's the RLS-level guard.
   The RPC provides the secure operation with audit logging and auth verification.
2. No changes to msg_insert, msg_select, msg_update policies.
3. No changes to conversation RLS policies.
4. Realtime respects RLS — Supabase Postgres Changes are filtered by RLS policies.
*/

-- 1. Add 'message_deleted' to audit_action enum
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'message_deleted';

-- 2. Create admin_delete_message RPC
CREATE OR REPLACE FUNCTION public.admin_delete_message(p_message_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid;
  v_msg messages%ROWTYPE;
BEGIN
  v_admin_id := auth.uid();

  -- 1. Require authentication
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 2. Verify caller is an admin
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- 3. Verify the message exists and get its metadata
  SELECT * INTO v_msg FROM messages WHERE id = p_message_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  -- 4. Delete the message (only this one row)
  DELETE FROM messages WHERE id = p_message_id;

  -- 5. Log to audit table (store conversation_id and sender_id in reason for traceability)
  INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, reason)
  VALUES (
    v_admin_id,
    'message_deleted'::audit_action,
    'message',
    p_message_id,
    'conversation_id=' || v_msg.conversation_id || ' sender_id=' || v_msg.sender_id
  );

  -- 6. Return success
  RETURN json_build_object('success', true, 'message_id', p_message_id);
END;
$function$;

-- Grant execute to authenticated only (not anon)
REVOKE ALL ON FUNCTION public.admin_delete_message(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_message(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_message(uuid) TO authenticated;

-- 3. Fix notif_delete RLS policy — owner-only, NOT is_admin()
DROP POLICY IF EXISTS "notif_delete" ON notifications;
CREATE POLICY "notif_delete" ON notifications
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 4. Add tables to realtime publication
-- Supabase Postgres Changes respect RLS, so only authorized rows will be broadcast.
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.collaborations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sender_listings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
