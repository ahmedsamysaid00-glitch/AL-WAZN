/*
# Fix get_marketer_referrals RPC — missing total_count column in final SELECT

## Root Cause
The `get_marketer_referrals` function declares 18 return columns in its RETURNS TABLE clause,
but the final SELECT only provides 17 columns — it is missing `c.total_count`.
This causes a runtime "structure of query does not match function result type" error
every time the function is called, which is why the Referrals page stays stuck
in loading (the RPC always errors) and the Dashboard shows errors for referral data.

## Fix
Add `c.total_count` as the final column in the SELECT list.

## No other changes
- No table changes
- No RLS changes
- No business logic changes
- Commission calculation, payout logic, and all financial systems are untouched
*/

CREATE OR REPLACE FUNCTION public.get_marketer_referrals(
  p_status_filter text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_limit integer DEFAULT 10,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  marketer_id uuid,
  referral_code text,
  referred_user_id uuid,
  status referral_status,
  first_seen_at timestamp with time zone,
  registered_at timestamp with time zone,
  converted_at timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  referred_user_full_name text,
  referred_user_email text,
  referred_user_account_status text,
  total_commission_amount numeric,
  commission_count bigint,
  last_commission_date timestamp with time zone,
  commission_currency text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
BEGIN
  -- Auth check
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_caller;
  IF v_role NOT IN ('marketing', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- For admin, show all referrals; for marketing, only their own
  RETURN QUERY
  WITH base AS (
    SELECT
      r.id,
      r.marketer_id,
      r.referral_code,
      r.referred_user_id,
      r.status,
      r.first_seen_at,
      r.registered_at,
      r.converted_at,
      r.created_at,
      r.updated_at,
      p.full_name AS referred_user_full_name,
      p.email AS referred_user_email,
      p.account_status::text AS referred_user_account_status
    FROM marketing_referrals r
    LEFT JOIN profiles p ON r.referred_user_id = p.id
    WHERE
      (v_role = 'admin' OR r.marketer_id = v_caller)
      AND (
        p_status_filter IS NULL
        OR p_status_filter = 'all'
        OR (
          p_status_filter = 'registered' AND r.status IN ('registered', 'converted')
        )
        OR (
          p_status_filter = 'converted' AND r.status = 'converted'
        )
        OR (
          p_status_filter = 'not_converted' AND r.status IN ('attributed', 'registered')
        )
        OR (
          p_status_filter = 'active' AND r.status IN ('attributed', 'registered', 'converted')
        )
        OR (
          p_status_filter = 'inactive' AND r.status = 'expired'
        )
      )
      AND (
        p_search IS NULL
        OR trim(p_search) = ''
        OR p.email ILIKE '%' || trim(p_search) || '%'
        OR p.full_name ILIKE '%' || trim(p_search) || '%'
        OR r.referral_code ILIKE '%' || trim(p_search) || '%'
      )
  ),
  counted AS (
    SELECT b.*, COUNT(*) OVER() AS total_count FROM base b
  ),
  comm AS (
    SELECT
      referral_id,
      SUM(commission_amount) AS total_commission_amount,
      COUNT(*) AS commission_count,
      MAX(created_at) AS last_commission_date,
      (array_agg(currency))[1] AS commission_currency
    FROM marketing_commissions
    WHERE marketer_id = v_caller
      AND status IN ('pending', 'approved', 'paid')
    GROUP BY referral_id
  )
  SELECT
    c.id,
    c.marketer_id,
    c.referral_code,
    c.referred_user_id,
    c.status::referral_status,
    c.first_seen_at,
    c.registered_at,
    c.converted_at,
    c.created_at,
    c.updated_at,
    c.referred_user_full_name,
    c.referred_user_email,
    c.referred_user_account_status,
    COALESCE(comm.total_commission_amount, 0),
    COALESCE(comm.commission_count, 0),
    comm.last_commission_date,
    comm.commission_currency,
    c.total_count
  FROM counted c
  LEFT JOIN comm ON comm.referral_id = c.id
  ORDER BY c.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;
