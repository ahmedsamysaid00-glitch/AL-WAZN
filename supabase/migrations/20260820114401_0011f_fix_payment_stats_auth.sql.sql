/*
# Security Fix: Add admin authorization to get_payment_stats

## Issue
get_payment_stats() was callable by any authenticated user, exposing platform-wide
financial totals (volume, fees, pending, successful, failed, refunded) to non-admin users.

## Fix
Add is_admin() check at the start of the function body.
*/

CREATE OR REPLACE FUNCTION get_payment_stats()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
$$;

REVOKE EXECUTE ON FUNCTION get_payment_stats() FROM anon;
GRANT EXECUTE ON FUNCTION get_payment_stats() TO authenticated;
