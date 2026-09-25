/*
# Security Hardening: Convert calculate_platform_fee to SECURITY INVOKER

## Rationale
- Read-only function that calculates fee from active config
- Only reads platform_fee_settings (SELECT policy `true` for authenticated)
- No writes, no sensitive data exposure
- Called internally by initiate_payment (which is SECURITY DEFINER and can call it)
- Converting to INVOKER is safe
*/

CREATE OR REPLACE FUNCTION public.calculate_platform_fee(p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fee_config platform_fee_settings%ROWTYPE;
  v_fee numeric;
BEGIN
  SELECT * INTO v_fee_config FROM platform_fee_settings WHERE is_active = true LIMIT 1;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_fee := (p_amount * v_fee_config.percentage / 100) + v_fee_config.fixed_amount;
  IF v_fee > p_amount THEN
    v_fee := p_amount;
  END IF;
  RETURN ROUND(v_fee, 2);
END;
$function$;

-- Grant to authenticated (needed when called directly, and by initiate_payment which is DEFINER)
GRANT EXECUTE ON FUNCTION calculate_platform_fee(numeric) TO authenticated;
