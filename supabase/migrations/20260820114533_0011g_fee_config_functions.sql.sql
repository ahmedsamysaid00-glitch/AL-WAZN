/*
# Fix: Server-side fee config management with audit logging

## Issue
AdminFees.tsx inserts/updates platform_fee_settings directly from the frontend
and tries to insert audit_logs, but audit_logs has no INSERT policy for
authenticated users — the audit insert fails silently, so fee changes go unlogged.

## Fix
Create two SECURITY DEFINER functions:
- save_fee_config: inserts new fee config, ensures single active, logs to audit_logs
- activate_fee_config: activates an existing config, logs to audit_logs

Both verify is_admin() internally and handle audit logging server-side.
*/

CREATE OR REPLACE FUNCTION save_fee_config(
  p_percentage numeric,
  p_fixed_amount numeric,
  p_currency text
)
RETURNS platform_fee_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_config platform_fee_settings%ROWTYPE;
  v_admin_id uuid := auth.uid();
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can manage fee settings';
  END IF;

  IF p_percentage < 0 OR p_percentage > 100 THEN
    RAISE EXCEPTION 'Percentage must be between 0 and 100';
  END IF;

  IF p_fixed_amount < 0 THEN
    RAISE EXCEPTION 'Fixed amount cannot be negative';
  END IF;

  INSERT INTO platform_fee_settings (
    fee_type, percentage, fixed_amount, currency, is_active
  )
  VALUES (
    'percentage', p_percentage, p_fixed_amount, p_currency, true
  )
  RETURNING * INTO v_config;

  -- Audit log (bypasses RLS since this runs as owner)
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (
    v_admin_id, v_admin_id, 'fee_change', 'platform_fee_settings', v_config.id,
    'Set fee to ' || p_percentage || '% + ' || p_fixed_amount || ' ' || p_currency
  );

  RETURN v_config;
END;
$$;

CREATE OR REPLACE FUNCTION activate_fee_config(
  p_config_id uuid
)
RETURNS platform_fee_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_config platform_fee_settings%ROWTYPE;
  v_admin_id uuid := auth.uid();
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can manage fee settings';
  END IF;

  SELECT * INTO v_config FROM platform_fee_settings WHERE id = p_config_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fee configuration not found';
  END IF;

  UPDATE platform_fee_settings SET is_active = true
  WHERE id = p_config_id
  RETURNING * INTO v_config;

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (
    v_admin_id, v_admin_id, 'fee_change', 'platform_fee_settings', p_config_id,
    'Activated fee configuration'
  );

  RETURN v_config;
END;
$$;

REVOKE EXECUTE ON FUNCTION save_fee_config(numeric, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION activate_fee_config(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION save_fee_config(numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION activate_fee_config(uuid) TO authenticated;
