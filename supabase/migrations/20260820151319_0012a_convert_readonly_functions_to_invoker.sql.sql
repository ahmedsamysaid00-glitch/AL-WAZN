/*
# Security Hardening: Convert read-only functions to SECURITY INVOKER

## Rationale

### get_active_fee_config
- Read-only function returning the active fee config row
- platform_fee_settings has SELECT policy `true` for all authenticated users
- Converting to INVOKER is safe: the data is already readable by all authenticated users via RLS
- Removes one Security Advisor warning

### get_payment_stats
- Has internal is_admin() check that RAISEs EXCEPTION for non-admins before any queries run
- When called by admin, RLS policies on payments/refunds use is_admin() which returns true, so all rows visible
- When called by non-admin, the is_admin() check fires before any query executes
- Converting to INVOKER is safe: no information leakage possible
- Removes one Security Advisor warning

Both functions have locked search_path preserved.
*/

CREATE OR REPLACE FUNCTION public.get_active_fee_config()
RETURNS platform_fee_settings
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
SELECT * FROM platform_fee_settings WHERE is_active = true LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_payment_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_volume numeric := 0;
  v_fees numeric := 0;
  v_pending int := 0;
  v_successful int := 0;
  v_failed int := 0;
  v_refunded numeric := 0;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can view payment statistics';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_volume FROM payments WHERE status = 'paid';
  SELECT COALESCE(SUM(platform_fee), 0) INTO v_fees FROM payments WHERE status = 'paid';
  SELECT COUNT(*) INTO v_pending FROM payments WHERE status IN ('pending', 'processing');
  SELECT COUNT(*) INTO v_successful FROM payments WHERE status = 'paid';
  SELECT COUNT(*) INTO v_failed FROM payments WHERE status = 'failed';
  SELECT COALESCE(SUM(amount), 0) INTO v_refunded FROM refunds WHERE status IN ('processing', 'completed');

  RETURN json_build_object(
    'volume', v_volume,
    'fees', v_fees,
    'pending', v_pending,
    'successful', v_successful,
    'failed', v_failed,
    'refunded', v_refunded
  );
END;
$function$;

-- Re-grant EXECUTE to authenticated (conversion resets privileges)
GRANT EXECUTE ON FUNCTION get_active_fee_config() TO authenticated;
GRANT EXECUTE ON FUNCTION get_payment_stats() TO authenticated;
