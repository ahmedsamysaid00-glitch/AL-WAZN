-- Fix: Approval RPCs need to set app.bypass_guard = 'on' before updating
-- protected profile fields (role, account_status), since guard_profile_fields()
-- blocks non-admin direct updates. These RPCs already check is_admin() internally,
-- but the trigger fires on the UPDATE itself and needs the bypass session variable.

-- ============================================
-- Fix approve_role_change: set bypass guard before UPDATE
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

  -- Bypass the guard trigger since we already verified admin privileges
  PERFORM set_config('app.bypass_guard', 'on', true);

  -- Update role on the SAME profile (preserve UUID)
  UPDATE profiles SET role = v_request.requested_role, updated_at = now() WHERE id = v_request.user_id;

  -- Reset bypass guard
  PERFORM set_config('app.bypass_guard', 'off', true);

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
-- Fix approve_email_change: set bypass guard before UPDATE (email is not guarded but be safe)
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

  -- Bypass guard for profile email update
  PERFORM set_config('app.bypass_guard', 'on', true);

  -- Update email on the SAME auth account (preserve UUID)
  UPDATE auth.users SET email = v_new_email, updated_at = now() WHERE id = v_user_id;
  UPDATE profiles SET email = v_new_email, updated_at = now() WHERE id = v_user_id;

  -- Reset bypass guard
  PERFORM set_config('app.bypass_guard', 'off', true);

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

-- Re-execute privileges (preserved from original migration)
REVOKE EXECUTE ON FUNCTION approve_role_change(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION approve_email_change(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION approve_role_change(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_email_change(uuid, text) TO authenticated;
