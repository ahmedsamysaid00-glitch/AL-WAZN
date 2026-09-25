-- Fix set_maintenance_enabled: audit_logs.entity_id is uuid NOT NULL,
-- but the function was inserting p_platform (text like 'traveler') into it,
-- causing a type mismatch error that silently failed the entire RPC.

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

  -- Log to audit table (entity_id is uuid — use the row's id, not the platform text)
  INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, reason)
  VALUES (
    auth.uid(),
    CASE WHEN p_enabled THEN 'maintenance_enabled' ELSE 'maintenance_disabled' END,
    'maintenance_settings',
    v_row_id,
    CASE WHEN p_enabled THEN 'Maintenance enabled for ' || p_platform ELSE 'Maintenance disabled for ' || p_platform END
  );
END;
$function$;

-- Ensure only authenticated can execute (already the case, but be explicit)
REVOKE EXECUTE ON FUNCTION public.set_maintenance_enabled(text, boolean) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_maintenance_enabled(text, boolean) TO authenticated;
