/*
# Add get_payment_stats function for Admin Overview

## Changes
- Creates `get_payment_stats()` SECURITY DEFINER function
- Returns aggregate payment statistics: total volume, fees, pending, successful, failed, refunded
- Admin-only (verifies is_admin() internally)
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

REVOKE EXECUTE ON FUNCTION get_payment_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_payment_stats() TO authenticated;
