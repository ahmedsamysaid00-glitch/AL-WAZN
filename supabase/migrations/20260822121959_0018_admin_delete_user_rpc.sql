/*
# Admin Delete User RPC

## Summary
Adds a secure SECURITY DEFINER function `admin_delete_user(p_user_id uuid)` that allows
an admin to permanently delete a normal (non-admin) user and all their marketplace data.

## Changes

### 1. audit_action enum — new value
- Added `user_deleted` to the `audit_action` enum so the audit log can record the action.

### 2. audit_logs.target_user_id — made nullable + FK to SET NULL
- `target_user_id` was NOT NULL with ON DELETE CASCADE, meaning the audit log would be
  destroyed when the user's profile was deleted.
- Changed to nullable, FK to ON DELETE SET NULL, so the audit log SURVIVES user deletion.
- The deleted user's UUID is preserved in `entity_id`. Their email, role, and a summary of
  affected records are stored in `reason`.

### 3. Financial tables — FK columns made nullable + FK to SET NULL
To preserve financial/accounting history while removing the personal link:
- `payments.payer_id` → nullable, FK SET NULL
- `payments.payee_id` → nullable, FK SET NULL
- `refunds.requested_by` → nullable, FK SET NULL
- `financial_ledger_entries.user_id` → nullable, FK SET NULL
- `wallet_accounts.user_id` → nullable, FK SET NULL
- `orders.sender_id` → nullable, FK SET NULL
- `orders.traveler_id` → nullable, FK SET NULL
- `shipment_tracking_events.created_by` → nullable, FK SET NULL

This preserves all financial records (payments, ledger entries, refunds, wallet history,
orders, tracking events) while anonymizing the personal link to the deleted user.
The financial data (amounts, statuses, dates, order numbers) remains intact for audit.

### 4. admin_delete_user function
SECURITY DEFINER function that:
- Verifies the caller is an admin via `is_admin()`
- Rejects anonymous/non-admin callers
- Rejects deletion of admin accounts
- Rejects self-deletion
- Validates the target user exists
- Inserts an audit log BEFORE deletion (with user info in entity_id + reason)
- Anonymizes financial records (sets user FK columns to NULL)
- Deletes from `auth.users` — cascading to profiles, trips, sender_listings,
  collaborations, notifications, conversations, messages, verification_requests
- Returns success/error JSON

### 5. Execute grant
- `EXECUTE` granted to `authenticated` role only (not `anon`).
- The function body enforces `is_admin()` internally.

## Security
- SECURITY DEFINER runs as the function owner (postgres), bypassing RLS.
- `is_admin()` check at the top rejects non-admins.
- `auth.uid()` check prevents self-deletion.
- Role check prevents admin-account deletion.
- `anon` role has NO EXECUTE permission.
*/

-- 1. Add 'user_deleted' to audit_action enum
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'audit_action' AND e.enumlabel = 'user_deleted'
  ) THEN
    ALTER TYPE audit_action ADD VALUE 'user_deleted';
  END IF;
END $$;

-- 2. Make audit_logs.target_user_id nullable and change FK to SET NULL
ALTER TABLE audit_logs ALTER COLUMN target_user_id DROP NOT NULL;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'audit_logs_target_user_id_fkey'
      AND table_name = 'audit_logs'
  ) THEN
    ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_target_user_id_fkey;
  END IF;
END $$;

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_target_user_id_fkey
  FOREIGN KEY (target_user_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- 3. Make financial FK columns nullable + SET NULL

-- payments.payer_id
ALTER TABLE payments ALTER COLUMN payer_id DROP NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'payments_payer_id_fkey' AND table_name = 'payments') THEN
    ALTER TABLE payments DROP CONSTRAINT payments_payer_id_fkey;
  END IF;
END $$;
ALTER TABLE payments ADD CONSTRAINT payments_payer_id_fkey FOREIGN KEY (payer_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- payments.payee_id
ALTER TABLE payments ALTER COLUMN payee_id DROP NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'payments_payee_id_fkey' AND table_name = 'payments') THEN
    ALTER TABLE payments DROP CONSTRAINT payments_payee_id_fkey;
  END IF;
END $$;
ALTER TABLE payments ADD CONSTRAINT payments_payee_id_fkey FOREIGN KEY (payee_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- refunds.requested_by
ALTER TABLE refunds ALTER COLUMN requested_by DROP NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'refunds_requested_by_fkey' AND table_name = 'refunds') THEN
    ALTER TABLE refunds DROP CONSTRAINT refunds_requested_by_fkey;
  END IF;
END $$;
ALTER TABLE refunds ADD CONSTRAINT refunds_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- financial_ledger_entries.user_id
ALTER TABLE financial_ledger_entries ALTER COLUMN user_id DROP NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'financial_ledger_entries_user_id_fkey' AND table_name = 'financial_ledger_entries') THEN
    ALTER TABLE financial_ledger_entries DROP CONSTRAINT financial_ledger_entries_user_id_fkey;
  END IF;
END $$;
ALTER TABLE financial_ledger_entries ADD CONSTRAINT financial_ledger_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- wallet_accounts.user_id
ALTER TABLE wallet_accounts ALTER COLUMN user_id DROP NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'wallet_accounts_user_id_fkey' AND table_name = 'wallet_accounts') THEN
    ALTER TABLE wallet_accounts DROP CONSTRAINT wallet_accounts_user_id_fkey;
  END IF;
END $$;
ALTER TABLE wallet_accounts ADD CONSTRAINT wallet_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- orders.sender_id
ALTER TABLE orders ALTER COLUMN sender_id DROP NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'orders_sender_id_fkey' AND table_name = 'orders') THEN
    ALTER TABLE orders DROP CONSTRAINT orders_sender_id_fkey;
  END IF;
END $$;
ALTER TABLE orders ADD CONSTRAINT orders_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- orders.traveler_id
ALTER TABLE orders ALTER COLUMN traveler_id DROP NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'orders_traveler_id_fkey' AND table_name = 'orders') THEN
    ALTER TABLE orders DROP CONSTRAINT orders_traveler_id_fkey;
  END IF;
END $$;
ALTER TABLE orders ADD CONSTRAINT orders_traveler_id_fkey FOREIGN KEY (traveler_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- shipment_tracking_events.created_by
ALTER TABLE shipment_tracking_events ALTER COLUMN created_by DROP NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'shipment_tracking_events_created_by_fkey' AND table_name = 'shipment_tracking_events') THEN
    ALTER TABLE shipment_tracking_events DROP CONSTRAINT shipment_tracking_events_created_by_fkey;
  END IF;
END $$;
ALTER TABLE shipment_tracking_events ADD CONSTRAINT shipment_tracking_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- 4. Create admin_delete_user function
CREATE OR REPLACE FUNCTION admin_delete_user(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  -- Reject anonymous callers
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Reject non-admin callers
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Reject self-deletion
  IF v_caller_id = p_user_id THEN
    RAISE EXCEPTION 'Cannot delete your own account';
  END IF;

  -- Validate target user exists and get info
  SELECT role, email, full_name
    INTO v_target_role, v_target_email, v_target_name
    FROM profiles
    WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Reject deletion of admin accounts
  IF v_target_role = 'admin' THEN
    RAISE EXCEPTION 'Cannot delete admin accounts';
  END IF;

  -- Count affected records for audit summary
  SELECT count(*) INTO v_trips_count FROM trips WHERE traveler_id = p_user_id;
  SELECT count(*) INTO v_listings_count FROM sender_listings WHERE sender_id = p_user_id;
  SELECT count(*) INTO v_collabs_count FROM collaborations WHERE sender_id = p_user_id OR traveler_id = p_user_id;
  SELECT count(*) INTO v_orders_count FROM orders WHERE sender_id = p_user_id OR traveler_id = p_user_id;
  SELECT count(*) INTO v_payments_count FROM payments WHERE payer_id = p_user_id OR payee_id = p_user_id;
  SELECT count(*) INTO v_notifications_count FROM notifications WHERE user_id = p_user_id;
  SELECT count(*) INTO v_verifications_count FROM verification_requests WHERE user_id = p_user_id;

  v_summary := json_build_object(
    'trips', v_trips_count,
    'listings', v_listings_count,
    'collaborations', v_collabs_count,
    'orders', v_orders_count,
    'payments', v_payments_count,
    'notifications', v_notifications_count,
    'verifications', v_verifications_count
  );

  -- Insert audit log BEFORE deletion (target_user_id will be SET NULL when profile is deleted)
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

  -- Anonymize financial records (set user FK to NULL, preserving the financial data)
  UPDATE payments SET payer_id = NULL WHERE payer_id = p_user_id;
  UPDATE payments SET payee_id = NULL WHERE payee_id = p_user_id;
  UPDATE refunds SET requested_by = NULL WHERE requested_by = p_user_id;
  UPDATE financial_ledger_entries SET user_id = NULL WHERE user_id = p_user_id;
  UPDATE wallet_accounts SET user_id = NULL WHERE user_id = p_user_id;
  UPDATE orders SET sender_id = NULL WHERE sender_id = p_user_id;
  UPDATE orders SET traveler_id = NULL WHERE traveler_id = p_user_id;
  UPDATE shipment_tracking_events SET created_by = NULL WHERE created_by = p_user_id;

  -- Delete from auth.users — CASCADE will remove:
  -- profiles, trips, sender_listings, collaborations, conversations, messages,
  -- notifications, verification_requests
  DELETE FROM auth.users WHERE id = p_user_id;

  RETURN json_build_object('success', true, 'message', 'User deleted successfully');
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to delete user: %', SQLERRM;
END;
$$;

-- 5. Grant EXECUTE to authenticated only (not anon)
REVOKE EXECUTE ON FUNCTION admin_delete_user(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION admin_delete_user(uuid) TO authenticated;
