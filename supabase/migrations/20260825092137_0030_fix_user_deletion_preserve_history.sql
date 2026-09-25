-- Fix user deletion: preserve historical/financial records while removing personal data
--
-- Root cause of the current error:
--   shipment_receipt_photos.traveler_id is NOT NULL but has FK ON DELETE SET NULL.
--   When a traveler's profile is CASCADE-deleted, Postgres tries to SET NULL
--   the traveler_id column, which violates the NOT NULL constraint.
--
-- Additional fixes:
--   1. audit_logs.admin_id FK was CASCADE — destroys audit history if an admin
--      is ever deleted. Changed to SET NULL to preserve audit logs.
--   2. verification_requests.reviewed_by FK was NO ACTION — would block profile
--      deletion. Changed to SET NULL (RPC already nullifies it, but FK should
--      also be safe for direct deletes).
--   3. Updated admin_delete_user RPC to nullify shipment_receipt_photos.traveler_id
--      and delivery_qr_tokens references before CASCADE, and to include
--      refunds/wallet/ledger counts in the audit summary.

-- =====================================================
-- 1. Fix shipment_receipt_photos.traveler_id: make nullable
-- =====================================================
ALTER TABLE shipment_receipt_photos ALTER COLUMN traveler_id DROP NOT NULL;

-- =====================================================
-- 2. Fix audit_logs.admin_id: CASCADE -> SET NULL
-- =====================================================
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'audit_logs_admin_id_fkey'
      AND table_name = 'audit_logs'
  ) THEN
    ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_admin_id_fkey;
  END IF;
END $$;
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_admin_id_fkey
  FOREIGN KEY (admin_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- Also make admin_id nullable (it was NOT NULL, but SET NULL requires nullable)
ALTER TABLE audit_logs ALTER COLUMN admin_id DROP NOT NULL;

-- =====================================================
-- 3. Fix verification_requests.reviewed_by: NO ACTION -> SET NULL
-- =====================================================
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'verification_requests_reviewed_by_fkey'
      AND table_name = 'verification_requests'
  ) THEN
    ALTER TABLE verification_requests DROP CONSTRAINT verification_requests_reviewed_by_fkey;
  END IF;
END $$;
ALTER TABLE verification_requests
  ADD CONSTRAINT verification_requests_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- =====================================================
-- 4. Update admin_delete_user RPC
-- =====================================================
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
  v_refunds_count int;
  v_wallet_count int;
  v_ledger_count int;
  v_notifications_count int;
  v_verifications_count int;
  v_conversations_count int;
  v_messages_count int;
  v_receipt_photos_count int;
  v_has_historical_orders boolean;
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
  SELECT count(*) INTO v_refunds_count FROM refunds WHERE requested_by = p_user_id OR approved_by = p_user_id;
  SELECT count(*) INTO v_wallet_count FROM wallet_accounts WHERE user_id = p_user_id;
  SELECT count(*) INTO v_ledger_count FROM financial_ledger_entries WHERE user_id = p_user_id;
  SELECT count(*) INTO v_notifications_count FROM notifications WHERE user_id = p_user_id;
  SELECT count(*) INTO v_verifications_count FROM verification_requests WHERE user_id = p_user_id;
  SELECT count(*) INTO v_conversations_count FROM conversations WHERE sender_id = p_user_id OR traveler_id = p_user_id;
  SELECT count(*) INTO v_messages_count FROM messages WHERE sender_id = p_user_id;
  SELECT count(*) INTO v_receipt_photos_count FROM shipment_receipt_photos WHERE traveler_id = p_user_id;

  -- Check if user has any delivered/completed orders (historical records)
  SELECT EXISTS(
    SELECT 1 FROM orders
    WHERE (sender_id = p_user_id OR traveler_id = p_user_id)
    AND status IN ('delivered', 'received', 'completed')
  ) INTO v_has_historical_orders;

  v_summary := json_build_object(
    'trips', v_trips_count,
    'listings', v_listings_count,
    'collaborations', v_collabs_count,
    'orders', v_orders_count,
    'payments', v_payments_count,
    'refunds', v_refunds_count,
    'wallet_accounts', v_wallet_count,
    'ledger_entries', v_ledger_count,
    'notifications', v_notifications_count,
    'verifications', v_verifications_count,
    'conversations', v_conversations_count,
    'messages', v_messages_count,
    'receipt_photos', v_receipt_photos_count,
    'has_historical_orders', v_has_historical_orders
  );

  -- 7. Insert audit log BEFORE deletion (target_user_id will be SET NULL when profile is deleted)
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (
    v_caller_id,
    p_user_id,
    'user_deleted'::audit_action,
    'user',
    p_user_id,
    format('Deleted user: %s (%s) | Role: %s | Historical orders: %s | Summary: %s',
      COALESCE(v_target_name, 'Unknown'),
      v_target_email,
      v_target_role,
      CASE WHEN v_has_historical_orders THEN 'yes' ELSE 'no' END,
      v_summary::text
    )
  );

  -- 8. Anonymize financial records (SET NULL, preserving the financial data)
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
  UPDATE orders SET collaboration_id = NULL
    WHERE collaboration_id IN (SELECT id FROM collaborations WHERE sender_id = p_user_id OR traveler_id = p_user_id);
  UPDATE orders SET trip_id = NULL
    WHERE trip_id IN (SELECT id FROM trips WHERE traveler_id = p_user_id);
  UPDATE orders SET sender_listing_id = NULL
    WHERE sender_listing_id IN (SELECT id FROM sender_listings WHERE sender_id = p_user_id);

  -- 11. Nullify shipment tracking created_by
  UPDATE shipment_tracking_events SET created_by = NULL WHERE created_by = p_user_id;

  -- 12. Nullify shipment receipt photos traveler_id (FIX: was blocked by NOT NULL)
  UPDATE shipment_receipt_photos SET traveler_id = NULL WHERE traveler_id = p_user_id;

  -- 13. Nullify delivery QR token references
  UPDATE delivery_qr_tokens SET revoked_by = NULL WHERE revoked_by = p_user_id;
  UPDATE delivery_qr_tokens SET used_by = NULL WHERE used_by = p_user_id;

  -- 14. Nullify verification_requests reviewed_by
  UPDATE verification_requests SET reviewed_by = NULL WHERE reviewed_by = p_user_id;

  -- 15. Nullify user_requests reviewed_by
  UPDATE user_requests SET reviewed_by = NULL WHERE reviewed_by = p_user_id;

  -- 16. Delete from auth.users — CASCADE will remove:
  --     profiles, trips, sender_listings, collaborations, conversations, messages,
  --     notifications, verification_requests, message_moderation_events,
  --     notification_preferences, user_requests
  --     Orders, payments, refunds, wallet, ledger, shipment tracking, receipt photos
  --     are preserved (user_id columns already NULLed above)
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
