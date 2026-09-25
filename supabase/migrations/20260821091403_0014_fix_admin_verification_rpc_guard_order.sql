-- Fix: admin_approve_verification and admin_reject_verification
-- Root cause: The guard trigger on verification_requests (vr_guard_fields)
-- blocks changes to status/reviewed_at/reviewed_by/rejection_reason
-- unless app.bypass_guard is set to 'on'. The functions were setting
-- app.bypass_guard AFTER the verification_requests UPDATE, so the trigger
-- fired and raised an exception, rolling back the entire transaction.
--
-- Fix: Move set_config('app.bypass_guard', 'on', true) BEFORE the
-- verification_requests UPDATE in both functions.

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

  -- Lock the request row
  SELECT * INTO v_request
  FROM verification_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification request not found';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  -- Bypass guard BEFORE updating verification_requests
  -- (vr_guard_fields trigger blocks status/reviewed_at/reviewed_by changes)
  PERFORM set_config('app.bypass_guard', 'on', true);

  -- Update the request
  UPDATE verification_requests
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = v_admin_id
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  -- Update the profile (guard still bypassed)
  UPDATE profiles
  SET verification_status = 'approved',
      identity_verified = true,
      account_status = 'active'
  WHERE id = v_request.user_id;

  -- Turn guard back on
  PERFORM set_config('app.bypass_guard', 'off', true);

  -- Insert audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_admin_id, v_request.user_id, 'verification_approved', 'verification_request', p_request_id);

  RETURN v_request;
END;
$function$;

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

  -- Lock the request row
  SELECT * INTO v_request
  FROM verification_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification request not found';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  -- Bypass guard BEFORE updating verification_requests
  -- (vr_guard_fields trigger blocks status/reviewed_at/reviewed_by/rejection_reason changes)
  PERFORM set_config('app.bypass_guard', 'on', true);

  -- Update the request
  UPDATE verification_requests
  SET status = 'rejected',
      rejection_reason = trim(p_reason),
      reviewed_at = now(),
      reviewed_by = v_admin_id
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  -- Update the profile (guard still bypassed)
  UPDATE profiles
  SET verification_status = 'rejected',
      identity_verified = false
  WHERE id = v_request.user_id;

  -- Turn guard back on
  PERFORM set_config('app.bypass_guard', 'off', true);

  -- Insert audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_admin_id, v_request.user_id, 'verification_rejected', 'verification_request', p_request_id, trim(p_reason));

  RETURN v_request;
END;
$function$;

-- Ensure only authenticated role can execute (revoke from anon and public)
REVOKE EXECUTE ON FUNCTION public.admin_approve_verification(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_reject_verification(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_approve_verification(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_verification(uuid, text) TO authenticated;
