/*
# Update Payment Receiving Number RPC

## Summary
Creates a `SECURITY DEFINER` RPC `update_payment_receiving_number(p_number text)`
that allows an admin to atomically update the platform payment receiving number.

## Security
- SECURITY DEFINER with search_path = public
- Verifies caller is an admin via is_admin()
- Validates the number server-side (non-empty, trimmed, 8-15 digits)
- Updates `updated_by` and `updated_at`
- Creates an audit log entry with old and new values
- Returns the saved number
- Revokes execute from anon and public
*/

CREATE OR REPLACE FUNCTION update_payment_receiving_number(p_number text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_clean text;
  v_old text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can update the payment receiving number';
  END IF;

  v_clean := trim(p_number);

  IF v_clean IS NULL OR v_clean = '' THEN
    RAISE EXCEPTION 'Payment receiving number cannot be empty';
  END IF;

  -- Allow digits, spaces, hyphens, plus sign — strip non-digits for length check
  IF NOT regexp_match(v_clean, '^[0-9+][0-9+\-\s]+$') IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid receiving number format: must contain only digits, spaces, hyphens, or a leading plus';
  END IF;

  -- Digit count must be between 8 and 15
  IF length(regexp_replace(v_clean, '[^0-9]', '', 'g')) < 8
     OR length(regexp_replace(v_clean, '[^0-9]', '', 'g')) > 15 THEN
    RAISE EXCEPTION 'Receiving number must contain 8 to 15 digits';
  END IF;

  SELECT payment_receiving_number INTO v_old FROM platform_settings LIMIT 1;

  UPDATE platform_settings
  SET payment_receiving_number = v_clean,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = (SELECT id FROM platform_settings LIMIT 1);

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (
    auth.uid(), NULL, 'payment_receiving_number_changed',
    'platform_settings',
    (SELECT id FROM platform_settings LIMIT 1),
    'Old: ' || COALESCE(v_old, 'NULL') || ' | New: ' || v_clean
  );

  RETURN v_clean;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_payment_receiving_number(text) FROM anon, public;
