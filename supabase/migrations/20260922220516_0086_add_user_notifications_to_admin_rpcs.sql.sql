/*
# Fix: Admin approve/reject RPCs don't notify users

## Problem
When an admin approves or rejects a user's request (role change, email change,
verification, or account deletion), the user is never notified. They have to
manually check the settings page to discover their request was processed.

## Fix
1. Add new notification_type enum values for user-facing approval/rejection.
2. Update each admin RPC to INSERT a notification for the requesting user.
3. For account_deletion_approved, the user is deleted so no notification
   is needed (the deletion itself is the signal).
4. For account_deletion_rejected, notify the user their request was rejected.

## Security
- Notifications are inserted via SECURITY DEFINER functions that already
  verify admin access. The notification INSERT uses the user's own user_id,
  so only they can read it (via notif_select RLS policy).
- No new EXECUTE grants needed — the functions are already restricted.
*/

-- Add new notification types for user-facing request outcomes
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'request_approved';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'request_rejected';

-- ============================================================
-- approve_role_change: notify user
-- ============================================================
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

PERFORM set_config('app.bypass_guard', 'on', true);
UPDATE profiles SET role = v_request.requested_role, updated_at = now() WHERE id = v_request.user_id;
PERFORM set_config('app.bypass_guard', 'off', true);

UPDATE user_requests
SET status = 'approved', reviewed_by = v_caller_id, reviewed_at = now(), admin_reason = p_admin_reason
WHERE id = p_request_id;

INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
VALUES (v_caller_id, v_request.user_id, 'role_change_approved'::audit_action, 'user_request', p_request_id,
COALESCE(p_admin_reason, 'Role change approved: ' || v_request.previous_role || ' -> ' || v_request.requested_role));

INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
VALUES (v_request.user_id, 'request_approved', 'Role change approved',
'Your request to change your role to ' || v_request.requested_role::text || ' has been approved.',
'user_request', p_request_id);

RETURN json_build_object('success', true, 'message', 'Role change approved');
END;
$function$;

-- ============================================================
-- reject_role_change: notify user
-- ============================================================
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

INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
VALUES (v_request.user_id, 'request_rejected', 'Role change request rejected',
'Your role change request was rejected. Reason: ' || p_reason,
'user_request', p_request_id);

RETURN json_build_object('success', true, 'message', 'Role change rejected');
END;
$function$;

-- ============================================================
-- approve_email_change: notify user
-- ============================================================
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

IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(v_new_email) AND id <> v_user_id) THEN
RAISE EXCEPTION 'Email is already in use by another account';
END IF;

PERFORM set_config('app.bypass_guard', 'on', true);
UPDATE auth.users SET email = v_new_email, updated_at = now() WHERE id = v_user_id;
UPDATE profiles SET email = v_new_email, updated_at = now() WHERE id = v_user_id;
PERFORM set_config('app.bypass_guard', 'off', true);

UPDATE user_requests
SET status = 'approved', reviewed_by = v_caller_id, reviewed_at = now(), admin_reason = p_admin_reason
WHERE id = p_request_id;

INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
VALUES (v_caller_id, v_user_id, 'email_change_approved'::audit_action, 'user_request', p_request_id,
COALESCE(p_admin_reason, 'Email change approved'));

INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
VALUES (v_user_id, 'request_approved', 'Email change approved',
'Your email has been updated to ' || v_new_email,
'user_request', p_request_id);

RETURN json_build_object('success', true, 'message', 'Email change approved');
END;
$function$;

-- ============================================================
-- reject_email_change: notify user
-- ============================================================
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

INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
VALUES (v_request.user_id, 'request_rejected', 'Email change request rejected',
'Your email change request was rejected. Reason: ' || p_reason,
'user_request', p_request_id);

RETURN json_build_object('success', true, 'message', 'Email change rejected');
END;
$function$;

-- ============================================================
-- reject_account_deletion: notify user
-- (approve_account_deletion deletes the user, so no notification needed)
-- ============================================================
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

INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
VALUES (v_request.user_id, 'request_rejected', 'Account deletion request rejected',
'Your account deletion request was rejected. Reason: ' || p_reason,
'user_request', p_request_id);

RETURN json_build_object('success', true, 'message', 'Account deletion rejected');
END;
$function$;

-- ============================================================
-- admin_approve_verification: notify user
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_approve_verification(p_request_id uuid)
RETURNS verification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_request verification_requests;
v_admin_id uuid;
BEGIN
v_admin_id := auth.uid();
IF v_admin_id IS NULL THEN
RAISE EXCEPTION 'Authentication required';
END IF;
IF NOT public.is_admin() THEN
RAISE EXCEPTION 'Admin access required';
END IF;

SELECT * INTO v_request FROM verification_requests WHERE id = p_request_id FOR UPDATE;
IF NOT FOUND THEN
RAISE EXCEPTION 'Verification request not found';
END IF;
IF v_request.status <> 'pending' THEN
RAISE EXCEPTION 'Request is not pending';
END IF;

PERFORM set_config('app.bypass_guard', 'on', true);
UPDATE verification_requests
SET status = 'approved', reviewed_at = now(), reviewed_by = v_admin_id
WHERE id = p_request_id
RETURNING * INTO v_request;
UPDATE profiles
SET verification_status = 'approved', identity_verified = true, account_status = 'active'
WHERE id = v_request.user_id;
PERFORM set_config('app.bypass_guard', 'off', true);

INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
VALUES (v_admin_id, v_request.user_id, 'verification_approved', 'verification_request', p_request_id);

INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
VALUES (v_request.user_id, 'request_approved', 'Identity verification approved',
'Your identity verification has been approved. Your account is now verified.',
'verification_request', p_request_id);

RETURN v_request;
END;
$function$;

-- ============================================================
-- admin_reject_verification: notify user
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_reject_verification(p_request_id uuid, p_reason text)
RETURNS verification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_request verification_requests;
v_admin_id uuid;
BEGIN
v_admin_id := auth.uid();
IF v_admin_id IS NULL THEN
RAISE EXCEPTION 'Authentication required';
END IF;
IF NOT public.is_admin() THEN
RAISE EXCEPTION 'Admin access required';
END IF;
IF p_reason IS NULL OR char_length(trim(p_reason)) = 0 THEN
RAISE EXCEPTION 'Rejection reason is required';
END IF;

SELECT * INTO v_request FROM verification_requests WHERE id = p_request_id FOR UPDATE;
IF NOT FOUND THEN
RAISE EXCEPTION 'Verification request not found';
END IF;
IF v_request.status <> 'pending' THEN
RAISE EXCEPTION 'Request is not pending';
END IF;

PERFORM set_config('app.bypass_guard', 'on', true);
UPDATE verification_requests
SET status = 'rejected', rejection_reason = trim(p_reason), reviewed_at = now(), reviewed_by = v_admin_id
WHERE id = p_request_id
RETURNING * INTO v_request;
UPDATE profiles
SET verification_status = 'rejected', identity_verified = false
WHERE id = v_request.user_id;
PERFORM set_config('app.bypass_guard', 'off', true);

INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
VALUES (v_admin_id, v_request.user_id, 'verification_rejected', 'verification_request', p_request_id, trim(p_reason));

INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id)
VALUES (v_request.user_id, 'request_rejected', 'Identity verification rejected',
'Your identity verification was rejected. Reason: ' || trim(p_reason),
'verification_request', p_request_id);

RETURN v_request;
END;
$function$;

-- Revoke execute from public/anon on all modified functions
REVOKE EXECUTE ON FUNCTION public.approve_role_change(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_role_change(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_email_change(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_email_change(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_account_deletion(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_approve_verification(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_reject_verification(uuid, text) FROM PUBLIC, anon;
