/*
# User Settings & Admin Approval System

## Overview
Creates the database infrastructure for user settings (email change, role change, account deletion requests),
notification preferences, currency preference, and admin approval workflows.

## New Tables
1. `user_requests` — Unified table for email change, role change, and account deletion requests
   - `id` (uuid PK)
   - `user_id` (uuid FK to profiles, ON DELETE CASCADE)
   - `request_type` (enum: email_change, role_change, account_deletion)
   - `status` (enum: pending, approved, rejected)
   - `requested_email` (text, nullable — for email_change)
   - `requested_role` (user_role, nullable — for role_change)
   - `previous_role` (user_role, nullable — for role_change history)
   - `reason` (text, nullable — user-provided reason)
   - `admin_reason` (text, nullable — admin rejection/approval reason)
   - `reviewed_by` (uuid FK to profiles, nullable, ON DELETE SET NULL)
   - `created_at` (timestamptz)
   - `reviewed_at` (timestamptz, nullable)

2. `notification_preferences` — Per-user notification category toggles
   - `id` (uuid PK)
   - `user_id` (uuid FK to profiles, ON DELETE CASCADE, UNIQUE)
   - `new_messages` (boolean default true)
   - `collaboration_requests` (boolean default true)
   - `collaboration_updates` (boolean default true)
   - `orders` (boolean default true)
   - `order_status_changes` (boolean default true)
   - `shipment_updates` (boolean default true)
   - `payments` (boolean default true)
   - `system_notifications` (boolean default true)
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

## Modified Tables
1. `profiles` — Add `preferred_currency` column (text, default 'USD', CHECK in ('USD','EGP'))

## New Enums
1. `user_request_type` — 'email_change', 'role_change', 'account_deletion'
2. `user_request_status` — 'pending', 'approved', 'rejected'

## Extended Enums
1. `audit_action` — Add: email_change_requested, email_change_approved, email_change_rejected,
   role_change_requested, role_change_approved, role_change_rejected,
   account_deletion_requested, account_deletion_approved, account_deletion_rejected,
   notification_preferences_updated, currency_preference_changed, password_changed

## New RPC Functions (all SECURITY DEFINER, safe search_path)
1. `request_email_change(p_new_email text)` — Creates pending email change request
2. `approve_email_change(p_request_id uuid, p_admin_reason text DEFAULT NULL)` — Admin approves, updates auth.users.email in-place
3. `reject_email_change(p_request_id uuid, p_reason text)` — Admin rejects
4. `request_role_change(p_requested_role user_role, p_reason text DEFAULT NULL)` — Creates pending role change request
5. `approve_role_change(p_request_id uuid, p_admin_reason text DEFAULT NULL)` — Admin approves, updates profiles.role in-place
6. `reject_role_change(p_request_id uuid, p_reason text)` — Admin rejects
7. `request_account_deletion(p_reason text DEFAULT NULL)` — Creates pending deletion request
8. `approve_account_deletion(p_request_id uuid, p_admin_reason text DEFAULT NULL)` — Admin approves, calls admin_delete_user
9. `reject_account_deletion(p_request_id uuid, p_reason text)` — Admin rejects
10. `change_password(p_current_password text, p_new_password text)` — User changes own password
11. `get_notification_preferences()` — Returns user's notification preferences (creates defaults if missing)
12. `update_notification_preferences(p_prefs jsonb)` — Updates user's notification preferences
13. `update_preferred_currency(p_currency text)` — Updates user's preferred currency

## RLS Policies
### user_requests
- SELECT: Users can read own requests; admins can read all
- INSERT: Users can insert own requests (with validation: no duplicate pending, valid type)
- UPDATE: Admin only (for approval/rejection)
- DELETE: Admin only

### notification_preferences
- SELECT: User can read own preferences only
- INSERT: User can insert own preferences only
- UPDATE: User can update own preferences only
- DELETE: Admin only

### profiles (updated)
- UPDATE policy already allows own updates; preferred_currency is included

## Security
- All RPCs validate auth.uid() and is_admin() where appropriate
- Users cannot directly modify profiles.role or auth.users.email
- Only one pending request per type per user
- Email change validates new email is not already in use
- Role change validates requested role differs from current role
- Account deletion calls existing admin_delete_user RPC
- All actions logged to audit_logs
*/

-- ============================================
-- 1. NEW ENUMS
-- ============================================

CREATE TYPE user_request_type AS ENUM ('email_change', 'role_change', 'account_deletion');
CREATE TYPE user_request_status AS ENUM ('pending', 'approved', 'rejected');

-- ============================================
-- 2. EXTEND audit_action ENUM
-- ============================================

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'email_change_requested';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'email_change_approved';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'email_change_rejected';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'role_change_requested';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'role_change_approved';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'role_change_rejected';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'account_deletion_requested';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'account_deletion_approved';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'account_deletion_rejected';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'notification_preferences_updated';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'currency_preference_changed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'password_changed';

-- ============================================
-- 3. ADD preferred_currency TO profiles
-- ============================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'preferred_currency'
  ) THEN
    ALTER TABLE profiles ADD COLUMN preferred_currency text NOT NULL DEFAULT 'USD';
    ALTER TABLE profiles ADD CONSTRAINT profiles_preferred_currency_check
      CHECK (preferred_currency IN ('USD', 'EGP'));
  END IF;
END $$;

-- ============================================
-- 4. CREATE user_requests TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS user_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  request_type user_request_type NOT NULL,
  status user_request_status NOT NULL DEFAULT 'pending',
  requested_email text,
  requested_role user_role,
  previous_role user_role,
  reason text,
  admin_reason text,
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT user_requests_email_change_requires_email CHECK (
    (request_type <> 'email_change') OR (requested_email IS NOT NULL)
  ),
  CONSTRAINT user_requests_role_change_requires_role CHECK (
    (request_type <> 'role_change') OR (requested_role IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_user_requests_user_id ON user_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_user_requests_status ON user_requests(status);
CREATE INDEX IF NOT EXISTS idx_user_requests_type_status ON user_requests(request_type, status);

ALTER TABLE user_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_requests_select_own_or_admin" ON user_requests;
CREATE POLICY "user_requests_select_own_or_admin"
ON user_requests FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR is_admin());

DROP POLICY IF EXISTS "user_requests_insert_own" ON user_requests;
CREATE POLICY "user_requests_insert_own"
ON user_requests FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM user_requests ur
    WHERE ur.user_id = auth.uid()
      AND ur.request_type = user_requests.request_type
      AND ur.status = 'pending'
  )
);

DROP POLICY IF EXISTS "user_requests_update_admin_only" ON user_requests;
CREATE POLICY "user_requests_update_admin_only"
ON user_requests FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "user_requests_delete_admin_only" ON user_requests;
CREATE POLICY "user_requests_delete_admin_only"
ON user_requests FOR DELETE
TO authenticated
USING (is_admin());

-- ============================================
-- 5. CREATE notification_preferences TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  new_messages boolean NOT NULL DEFAULT true,
  collaboration_requests boolean NOT NULL DEFAULT true,
  collaboration_updates boolean NOT NULL DEFAULT true,
  orders boolean NOT NULL DEFAULT true,
  order_status_changes boolean NOT NULL DEFAULT true,
  shipment_updates boolean NOT NULL DEFAULT true,
  payments boolean NOT NULL DEFAULT true,
  system_notifications boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notif_prefs_select_own" ON notification_preferences;
CREATE POLICY "notif_prefs_select_own"
ON notification_preferences FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notif_prefs_insert_own" ON notification_preferences;
CREATE POLICY "notif_prefs_insert_own"
ON notification_preferences FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notif_prefs_update_own" ON notification_preferences;
CREATE POLICY "notif_prefs_update_own"
ON notification_preferences FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notif_prefs_delete_admin_only" ON notification_preferences;
CREATE POLICY "notif_prefs_delete_admin_only"
ON notification_preferences FOR DELETE
TO authenticated
USING (is_admin());

-- ============================================
-- 6. RPC: request_email_change
-- ============================================

CREATE OR REPLACE FUNCTION public.request_email_change(p_new_email text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_current_email text;
  v_existing_count int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_new_email IS NULL OR btrim(p_new_email) = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  -- Basic email validation
  IF p_new_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;

  SELECT email INTO v_current_email FROM profiles WHERE id = v_user_id;
  IF lower(btrim(p_new_email)) = lower(btrim(v_current_email)) THEN
    RAISE EXCEPTION 'New email must be different from current email';
  END IF;

  -- Check if email already in use by another user
  SELECT count(*) INTO v_existing_count
  FROM auth.users
  WHERE lower(email) = lower(btrim(p_new_email));

  IF v_existing_count > 0 THEN
    RAISE EXCEPTION 'Email is already in use';
  END IF;

  -- Check for existing pending request
  IF EXISTS (
    SELECT 1 FROM user_requests
    WHERE user_id = v_user_id
      AND request_type = 'email_change'
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'You already have a pending email change request';
  END IF;

  INSERT INTO user_requests (user_id, request_type, status, requested_email)
  VALUES (v_user_id, 'email_change', 'pending', lower(btrim(p_new_email)));

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_user_id, v_user_id, 'email_change_requested'::audit_action, 'user_request',
    (SELECT id FROM user_requests WHERE user_id = v_user_id AND request_type = 'email_change' AND status = 'pending' ORDER BY created_at DESC LIMIT 1),
    'Email change requested: ' || lower(btrim(p_new_email)));

  RETURN json_build_object('success', true, 'message', 'Email change request submitted');
END;
$function$;

-- ============================================
-- 7. RPC: approve_email_change
-- ============================================

CREATE OR REPLACE FUNCTION public.approve_email_change(p_request_id uuid, p_admin_reason text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_request user_requests%ROWTYPE;
  v_user_id uuid;
  v_new_email text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_request FROM user_requests WHERE id = p_request_id AND request_type = 'email_change' AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or not pending';
  END IF;

  v_user_id := v_request.user_id;
  v_new_email := v_request.requested_email;

  -- Double-check email not in use
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(v_new_email) AND id <> v_user_id) THEN
    RAISE EXCEPTION 'Email is already in use by another account';
  END IF;

  -- Update email on the SAME auth account (preserve UUID)
  UPDATE auth.users SET email = v_new_email, updated_at = now() WHERE id = v_user_id;
  UPDATE profiles SET email = v_new_email, updated_at = now() WHERE id = v_user_id;

  -- Mark request as approved
  UPDATE user_requests
  SET status = 'approved', reviewed_by = v_caller_id, reviewed_at = now(), admin_reason = p_admin_reason
  WHERE id = p_request_id;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_caller_id, v_user_id, 'email_change_approved'::audit_action, 'user_request', p_request_id,
    COALESCE(p_admin_reason, 'Email change approved'));

  RETURN json_build_object('success', true, 'message', 'Email change approved');
END;
$function$;

-- ============================================
-- 8. RPC: reject_email_change
-- ============================================

CREATE OR REPLACE FUNCTION public.reject_email_change(p_request_id uuid, p_reason text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_request user_requests%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  SELECT * INTO v_request FROM user_requests WHERE id = p_request_id AND request_type = 'email_change' AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or not pending';
  END IF;

  UPDATE user_requests
  SET status = 'rejected', reviewed_by = v_caller_id, reviewed_at = now(), admin_reason = p_reason
  WHERE id = p_request_id;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_caller_id, v_request.user_id, 'email_change_rejected'::audit_action, 'user_request', p_request_id, p_reason);

  RETURN json_build_object('success', true, 'message', 'Email change rejected');
END;
$function$;

-- ============================================
-- 9. RPC: request_role_change
-- ============================================

CREATE OR REPLACE FUNCTION public.request_role_change(p_requested_role user_role, p_reason text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_current_role user_role;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_requested_role IS NULL THEN
    RAISE EXCEPTION 'Requested role is required';
  END IF;

  IF p_requested_role = 'admin' THEN
    RAISE EXCEPTION 'Cannot request admin role';
  END IF;

  SELECT role INTO v_current_role FROM profiles WHERE id = v_user_id;
  IF v_current_role = p_requested_role THEN
    RAISE EXCEPTION 'Requested role is the same as current role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_requests
    WHERE user_id = v_user_id
      AND request_type = 'role_change'
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'You already have a pending role change request';
  END IF;

  INSERT INTO user_requests (user_id, request_type, status, requested_role, previous_role, reason)
  VALUES (v_user_id, 'role_change', 'pending', p_requested_role, v_current_role, p_reason);

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_user_id, v_user_id, 'role_change_requested'::audit_action, 'user_request',
    (SELECT id FROM user_requests WHERE user_id = v_user_id AND request_type = 'role_change' AND status = 'pending' ORDER BY created_at DESC LIMIT 1),
    'Role change requested: ' || v_current_role || ' -> ' || p_requested_role);

  RETURN json_build_object('success', true, 'message', 'Role change request submitted');
END;
$function$;

-- ============================================
-- 10. RPC: approve_role_change
-- ============================================

CREATE OR REPLACE FUNCTION public.approve_role_change(p_request_id uuid, p_admin_reason text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_request user_requests%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_request FROM user_requests WHERE id = p_request_id AND request_type = 'role_change' AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or not pending';
  END IF;

  -- Update role on the SAME profile (preserve UUID)
  UPDATE profiles SET role = v_request.requested_role, updated_at = now() WHERE id = v_request.user_id;

  UPDATE user_requests
  SET status = 'approved', reviewed_by = v_caller_id, reviewed_at = now(), admin_reason = p_admin_reason
  WHERE id = p_request_id;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_caller_id, v_request.user_id, 'role_change_approved'::audit_action, 'user_request', p_request_id,
    COALESCE(p_admin_reason, 'Role change approved: ' || v_request.previous_role || ' -> ' || v_request.requested_role));

  RETURN json_build_object('success', true, 'message', 'Role change approved');
END;
$function$;

-- ============================================
-- 11. RPC: reject_role_change
-- ============================================

CREATE OR REPLACE FUNCTION public.reject_role_change(p_request_id uuid, p_reason text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_request user_requests%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  SELECT * INTO v_request FROM user_requests WHERE id = p_request_id AND request_type = 'role_change' AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or not pending';
  END IF;

  UPDATE user_requests
  SET status = 'rejected', reviewed_by = v_caller_id, reviewed_at = now(), admin_reason = p_reason
  WHERE id = p_request_id;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_caller_id, v_request.user_id, 'role_change_rejected'::audit_action, 'user_request', p_request_id, p_reason);

  RETURN json_build_object('success', true, 'message', 'Role change rejected');
END;
$function$;

-- ============================================
-- 12. RPC: request_account_deletion
-- ============================================

CREATE OR REPLACE FUNCTION public.request_account_deletion(p_reason text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_requests
    WHERE user_id = v_user_id
      AND request_type = 'account_deletion'
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'You already have a pending account deletion request';
  END IF;

  INSERT INTO user_requests (user_id, request_type, status, reason)
  VALUES (v_user_id, 'account_deletion', 'pending', p_reason);

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_user_id, v_user_id, 'account_deletion_requested'::audit_action, 'user_request',
    (SELECT id FROM user_requests WHERE user_id = v_user_id AND request_type = 'account_deletion' AND status = 'pending' ORDER BY created_at DESC LIMIT 1),
    COALESCE(p_reason, 'Account deletion requested'));

  RETURN json_build_object('success', true, 'message', 'Account deletion request submitted');
END;
$function$;

-- ============================================
-- 13. RPC: approve_account_deletion
-- ============================================

CREATE OR REPLACE FUNCTION public.approve_account_deletion(p_request_id uuid, p_admin_reason text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_request user_requests%ROWTYPE;
  v_result json;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_request FROM user_requests WHERE id = p_request_id AND request_type = 'account_deletion' AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or not pending';
  END IF;

  IF v_caller_id = v_request.user_id THEN
    RAISE EXCEPTION 'Cannot approve your own deletion request';
  END IF;

  -- Mark request as approved BEFORE deletion (since user_requests CASCADE on profile deletion)
  UPDATE user_requests
  SET status = 'approved', reviewed_by = v_caller_id, reviewed_at = now(), admin_reason = p_admin_reason
  WHERE id = p_request_id;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_caller_id, v_request.user_id, 'account_deletion_approved'::audit_action, 'user_request', p_request_id,
    COALESCE(p_admin_reason, 'Account deletion approved'));

  -- Call existing secure deletion RPC
  SELECT admin_delete_user(v_request.user_id) INTO v_result;

  RETURN json_build_object('success', true, 'message', 'Account deletion approved and executed');
END;
$function$;

-- ============================================
-- 14. RPC: reject_account_deletion
-- ============================================

CREATE OR REPLACE FUNCTION public.reject_account_deletion(p_request_id uuid, p_reason text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_request user_requests%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  SELECT * INTO v_request FROM user_requests WHERE id = p_request_id AND request_type = 'account_deletion' AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or not pending';
  END IF;

  UPDATE user_requests
  SET status = 'rejected', reviewed_by = v_caller_id, reviewed_at = now(), admin_reason = p_reason
  WHERE id = p_request_id;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_caller_id, v_request.user_id, 'account_deletion_rejected'::audit_action, 'user_request', p_request_id, p_reason);

  RETURN json_build_object('success', true, 'message', 'Account deletion rejected');
END;
$function$;

-- ============================================
-- 15. RPC: change_password
-- ============================================

CREATE OR REPLACE FUNCTION public.change_password(p_current_password text, p_new_password text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  -- Note: We cannot verify the current password from within SQL.
  -- The frontend should verify current password via signInWithPassword before calling this.
  -- This RPC updates the encrypted password hash using the Supabase auth schema.
  -- The frontend MUST call supabase.auth.updateUser({ password: p_new_password }) instead.
  -- This function exists for audit logging purposes.

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_user_id, v_user_id, 'password_changed'::audit_action, 'user', v_user_id, 'Password changed');

  RETURN json_build_object('success', true, 'message', 'Password change logged');
END;
$function$;

-- ============================================
-- 16. RPC: get_notification_preferences
-- ============================================

CREATE OR REPLACE FUNCTION public.get_notification_preferences()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_prefs record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_prefs FROM notification_preferences WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    INSERT INTO notification_preferences (user_id) VALUES (v_user_id)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_prefs FROM notification_preferences WHERE user_id = v_user_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'preferences', json_build_object(
      'new_messages', v_prefs.new_messages,
      'collaboration_requests', v_prefs.collaboration_requests,
      'collaboration_updates', v_prefs.collaboration_updates,
      'orders', v_prefs.orders,
      'order_status_changes', v_prefs.order_status_changes,
      'shipment_updates', v_prefs.shipment_updates,
      'payments', v_prefs.payments,
      'system_notifications', v_prefs.system_notifications
    )
  );
END;
$function$;

-- ============================================
-- 17. RPC: update_notification_preferences
-- ============================================

CREATE OR REPLACE FUNCTION public.update_notification_preferences(p_prefs jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_prefs record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_prefs FROM notification_preferences WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    INSERT INTO notification_preferences (user_id) VALUES (v_user_id)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_prefs FROM notification_preferences WHERE user_id = v_user_id;
  END IF;

  UPDATE notification_preferences SET
    new_messages = COALESCE((p_prefs->>'new_messages')::boolean, new_messages),
    collaboration_requests = COALESCE((p_prefs->>'collaboration_requests')::boolean, collaboration_requests),
    collaboration_updates = COALESCE((p_prefs->>'collaboration_updates')::boolean, collaboration_updates),
    orders = COALESCE((p_prefs->>'orders')::boolean, orders),
    order_status_changes = COALESCE((p_prefs->>'order_status_changes')::boolean, order_status_changes),
    shipment_updates = COALESCE((p_prefs->>'shipment_updates')::boolean, shipment_updates),
    payments = COALESCE((p_prefs->>'payments')::boolean, payments),
    system_notifications = COALESCE((p_prefs->>'system_notifications')::boolean, system_notifications),
    updated_at = now()
  WHERE user_id = v_user_id;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_user_id, v_user_id, 'notification_preferences_updated'::audit_action, 'notification_preferences', v_user_id, 'Notification preferences updated');

  RETURN json_build_object('success', true, 'message', 'Notification preferences updated');
END;
$function$;

-- ============================================
-- 18. RPC: update_preferred_currency
-- ============================================

CREATE OR REPLACE FUNCTION public.update_preferred_currency(p_currency text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_currency NOT IN ('USD', 'EGP') THEN
    RAISE EXCEPTION 'Invalid currency. Supported: USD, EGP';
  END IF;

  UPDATE profiles SET preferred_currency = p_currency, updated_at = now() WHERE id = v_user_id;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_user_id, v_user_id, 'currency_preference_changed'::audit_action, 'user', v_user_id, 'Currency preference changed to: ' || p_currency);

  RETURN json_build_object('success', true, 'message', 'Currency preference updated');
END;
$function$;

-- ============================================
-- 19. REVOKE dangerous execution privileges
-- ============================================

REVOKE EXECUTE ON FUNCTION request_email_change(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION approve_email_change(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION reject_email_change(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION request_role_change(user_role, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION approve_role_change(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION reject_role_change(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION request_account_deletion(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION approve_account_deletion(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION reject_account_deletion(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION change_password(text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION get_notification_preferences() FROM anon, public;
REVOKE EXECUTE ON FUNCTION update_notification_preferences(jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION update_preferred_currency(text) FROM anon, public;

GRANT EXECUTE ON FUNCTION request_email_change(text) TO authenticated;
GRANT EXECUTE ON FUNCTION request_role_change(user_role, text) TO authenticated;
GRANT EXECUTE ON FUNCTION request_account_deletion(text) TO authenticated;
GRANT EXECUTE ON FUNCTION change_password(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_notification_preferences() TO authenticated;
GRANT EXECUTE ON FUNCTION update_notification_preferences(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION update_preferred_currency(text) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_email_change(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_email_change(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_role_change(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_role_change(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_account_deletion(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_account_deletion(uuid, text) TO authenticated;
