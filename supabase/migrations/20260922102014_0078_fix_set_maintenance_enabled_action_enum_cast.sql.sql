-- Fix set_maintenance_enabled: the CASE expression for the audit_logs.action
-- column returns text, but the column is of type audit_action (enum).
-- PostgreSQL does not auto-cast text to enum in a PL/pgSQL INSERT, so the
-- RPC fails with: 42804: column "action" is of type audit_action but
-- expression is of type text.
--
-- This migration casts the CASE result explicitly to audit_action.

CREATE OR REPLACE FUNCTION public.set_maintenance_enabled(
  p_platform text,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row_id uuid;
  v_current_enabled boolean;
BEGIN
  -- Validate platform
  IF p_platform NOT IN ('traveler', 'sender', 'marketing', 'support') THEN
    RAISE EXCEPTION 'Invalid platform: %', p_platform;
  END IF;

  -- Verify admin
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- Get current value and row id
  SELECT id, enabled INTO v_row_id, v_current_enabled
  FROM maintenance_settings
  WHERE platform = p_platform;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Maintenance setting not found for platform: %', p_platform;
  END IF;

  -- No change needed
  IF v_current_enabled = p_enabled THEN
    RETURN;
  END IF;

  -- Update the setting
  UPDATE maintenance_settings
  SET enabled = p_enabled,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE platform = p_platform;

  -- Log to audit table
  -- action must be cast to audit_action enum type explicitly
  INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, reason)
  VALUES (
    auth.uid(),
    (CASE WHEN p_enabled THEN 'maintenance_enabled' ELSE 'maintenance_disabled' END)::audit_action,
    'maintenance_settings',
    v_row_id,
    CASE WHEN p_enabled THEN 'Maintenance enabled for ' || p_platform ELSE 'Maintenance disabled for ' || p_platform END
  );
END;
$function$;

-- Ensure only authenticated can execute
REVOKE EXECUTE ON FUNCTION public.set_maintenance_enabled(text, boolean) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_maintenance_enabled(text, boolean) TO authenticated;
