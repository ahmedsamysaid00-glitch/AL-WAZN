/*
# Update admin_delete_user RPC

## Changes
The existing RPC already handles most cases correctly:
- Anonymizes financial records (SET NULL on payments, refunds, ledger, wallet, orders, tracking)
- Inserts audit log BEFORE deletion
- Deletes from auth.users (CASCADE removes profile, trips, listings, collaborations, conversations, messages, notifications, verifications)

The only issue was the RESTRICT FK on orders -> collaborations/trips/sender_listings,
which is now fixed by the previous migration (changed to SET NULL).

This migration updates the RPC to also explicitly nullify order references
(collaboration_id, trip_id, sender_listing_id) BEFORE the CASCADE deletion
reaches collaborations/trips/sender_listings. This ensures orders are preserved
with NULL references even if the CASCADE would have set them to NULL anyway —
making the operation deterministic and explicit within the transaction.

Also adds verification_requests.reviewed_by handling: if the target user has
reviewed verification requests as an admin (shouldn't happen for non-admin targets,
but defensive), set those to NULL before deletion. The existing FK is NO ACTION
which would block deletion.
*/

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_target_role user_role;
  v_target_email text;
  v_target_name text;
  v_summary json;
  v_trips_count int;
  v_listings_count int;
  v_collabs_count int;
  v_orders_count int;
  v_payments_count int;
  v_notifications_count int;
  v_verifications_count int;
  v_conversations_count int;
  v_messages_count int;
BEGIN
  -- 1. Reject anonymous callers
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 2. Reject non-admin callers
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- 3. Reject self-deletion
  IF v_caller_id = p_user_id THEN
    RAISE EXCEPTION 'Cannot delete your own account';
  END IF;

  -- 4. Validate target user exists and get info
  SELECT role, email, full_name
  INTO v_target_role, v_target_email, v_target_name
  FROM profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- 5. Reject deletion of admin accounts
  IF v_target_role = 'admin' THEN
    RAISE EXCEPTION 'Cannot delete admin accounts';
  END IF;

  -- 6. Count affected records for audit summary
  SELECT count(*) INTO v_trips_count FROM trips WHERE traveler_id = p_user_id;
  SELECT count(*) INTO v_listings_count FROM sender_listings WHERE sender_id = p_user_id;
  SELECT count(*) INTO v_collabs_count FROM collaborations WHERE sender_id = p_user_id OR traveler_id = p_user_id;
  SELECT count(*) INTO v_orders_count FROM orders WHERE sender_id = p_user_id OR traveler_id = p_user_id;
  SELECT count(*) INTO v_payments_count FROM payments WHERE payer_id = p_user_id OR payee_id = p_user_id;
  SELECT count(*) INTO v_notifications_count FROM notifications WHERE user_id = p_user_id;
  SELECT count(*) INTO v_verifications_count FROM verification_requests WHERE user_id = p_user_id;
  SELECT count(*) INTO v_conversations_count FROM conversations WHERE sender_id = p_user_id OR traveler_id = p_user_id;
  SELECT count(*) INTO v_messages_count FROM messages WHERE sender_id = p_user_id;

  v_summary := json_build_object(
    'trips', v_trips_count,
    'listings', v_listings_count,
    'collaborations', v_collabs_count,
    'orders', v_orders_count,
    'payments', v_payments_count,
    'notifications', v_notifications_count,
    'verifications', v_verifications_count,
    'conversations', v_conversations_count,
    'messages', v_messages_count
  );

  -- 7. Insert audit log BEFORE deletion (target_user_id will be SET NULL when profile is deleted)
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (
    v_caller_id,
    p_user_id,
    'user_deleted'::audit_action,
    'user',
    p_user_id,
    format('Deleted user: %s (%s) | Role: %s | Summary: %s',
      COALESCE(v_target_name, 'Unknown'),
      v_target_email,
      v_target_role,
      v_summary::text
    )
  );

  -- 8. Anonymize financial records (set user FK to NULL, preserving the financial data)
  UPDATE payments SET payer_id = NULL WHERE payer_id = p_user_id;
  UPDATE payments SET payee_id = NULL WHERE payee_id = p_user_id;
  UPDATE refunds SET requested_by = NULL WHERE requested_by = p_user_id;
  UPDATE refunds SET approved_by = NULL WHERE approved_by = p_user_id;
  UPDATE financial_ledger_entries SET user_id = NULL WHERE user_id = p_user_id;
  UPDATE wallet_accounts SET user_id = NULL WHERE user_id = p_user_id;

  -- 9. Nullify order references to the user (preserve order records for accounting)
  UPDATE orders SET sender_id = NULL WHERE sender_id = p_user_id;
  UPDATE orders SET traveler_id = NULL WHERE traveler_id = p_user_id;

  -- 10. Nullify order references to collaborations/trips/listings that will be CASCADE-deleted
  --     This prevents any dependency issue during the CASCADE chain
  UPDATE orders SET collaboration_id = NULL
    WHERE collaboration_id IN (SELECT id FROM collaborations WHERE sender_id = p_user_id OR traveler_id = p_user_id);
  UPDATE orders SET trip_id = NULL
    WHERE trip_id IN (SELECT id FROM trips WHERE traveler_id = p_user_id);
  UPDATE orders SET sender_listing_id = NULL
    WHERE sender_listing_id IN (SELECT id FROM sender_listings WHERE sender_id = p_user_id);

  -- 11. Nullify shipment tracking created_by
  UPDATE shipment_tracking_events SET created_by = NULL WHERE created_by = p_user_id;

  -- 12. Handle verification_requests reviewed_by (NO ACTION FK would block)
  UPDATE verification_requests SET reviewed_by = NULL WHERE reviewed_by = p_user_id;

  -- 13. Delete from auth.users — CASCADE will remove:
  --     profiles, trips, sender_listings, collaborations, conversations, messages,
  --     notifications, verification_requests, message_moderation_events
  --     Orders are preserved (user_id columns already NULLed above)
  DELETE FROM auth.users WHERE id = p_user_id;

  RETURN json_build_object('success', true, 'message', 'User deleted successfully');
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to delete user: %', SQLERRM;
END;
$function$;

-- Ensure execute is only for authenticated
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
