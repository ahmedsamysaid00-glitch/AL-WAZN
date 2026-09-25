/*
# Fix all marketing RPC functions — ambiguous column references and nested aggregate error

## Root Causes

### 1. Ambiguous column reference "id" in role check (ALL RPCs)
Every marketing RPC function has this pattern:
  SELECT role INTO v_role FROM profiles WHERE id = v_caller;

The PL/pgSQL output column "id" (from RETURNS TABLE) conflicts with the
profiles.id column reference, causing:
  ERROR: column reference "id" is ambiguous
  It could refer to either a PL/pgSQL variable or a table column.

This affects: get_marketer_referrals, get_marketer_referral_detail,
get_marketer_commissions, get_marketing_completed_orders,
get_marketer_payouts, get_marketer_payouts_summary, get_marketer_analytics.

Fix: Qualify all column references with table aliases (profiles.id, profiles.role).

### 2. Nested aggregate in get_marketer_analytics commission summary
The commission summary subquery uses jsonb_object_agg with SUM/COUNT inside
jsonb_build_object, which causes:
  ERROR: aggregate function calls cannot be nested

Fix: Use a CTE to compute the aggregates first, then build the JSON object.

### 3. Ambiguous "currency" in get_marketer_payouts_summary
The final SELECT's COALESCE(pt.currency, ca.currency) AS currency conflicts
with the output column name "currency" from RETURNS TABLE.

Fix: The CTE already aliases properly, but the RETURN QUERY's column names
conflict. Qualify with CTE aliases (already done in the query itself, but
the issue is the output column name matching the table column name in the
FULL OUTER JOIN). Fix by ensuring all references are aliased.

## What changed
- All 7 marketing RPC functions recreated with fully-qualified column references
- get_marketer_analytics commission summary rewritten to avoid nested aggregates
- get_marketer_payouts_summary final SELECT disambiguated

## What was NOT changed
- No table structure changes
- No RLS policy changes
- No commission calculation logic
- No payout logic
- No financial triggers
- No payment provider integration
- Commission rates, statuses, and business rules remain identical
*/

-- ============================================================
-- 1. get_marketer_referrals — fix ambiguous column references
-- ============================================================

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
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT pr.role INTO v_role FROM profiles pr WHERE pr.id = v_caller;
  IF v_role NOT IN ('marketing', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

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
        OR (p_status_filter = 'registered' AND r.status IN ('registered', 'converted'))
        OR (p_status_filter = 'converted' AND r.status = 'converted')
        OR (p_status_filter = 'not_converted' AND r.status IN ('attributed', 'registered'))
        OR (p_status_filter = 'active' AND r.status IN ('attributed', 'registered', 'converted'))
        OR (p_status_filter = 'inactive' AND r.status = 'expired')
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
      mc.referral_id,
      SUM(mc.commission_amount) AS total_commission_amount,
      COUNT(*) AS commission_count,
      MAX(mc.created_at) AS last_commission_date,
      (array_agg(mc.currency))[1] AS commission_currency
    FROM marketing_commissions mc
    WHERE mc.marketer_id = v_caller
      AND mc.status IN ('pending', 'approved', 'paid')
    GROUP BY mc.referral_id
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

REVOKE EXECUTE ON FUNCTION get_marketer_referrals(text, text, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION get_marketer_referrals(text, text, int, int) TO authenticated;

-- ============================================================
-- 2. get_marketer_referral_detail — fix ambiguous column references
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_marketer_referral_detail(
  p_referral_id uuid
)
RETURNS TABLE(
  referral_id uuid,
  referral_code text,
  referred_user_id uuid,
  status referral_status,
  first_seen_at timestamp with time zone,
  registered_at timestamp with time zone,
  converted_at timestamp with time zone,
  created_at timestamp with time zone,
  referred_user_full_name text,
  referred_user_email text,
  referred_user_account_status text,
  commission_id uuid,
  order_id uuid,
  commission_amount numeric,
  gross_order_amount numeric,
  commission_status commission_status,
  commission_currency text,
  commission_created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_referral_marketer_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT pr.role INTO v_role FROM profiles pr WHERE pr.id = v_caller;
  IF v_role NOT IN ('marketing', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT r.marketer_id INTO v_referral_marketer_id
  FROM marketing_referrals r WHERE r.id = p_referral_id;

  IF v_referral_marketer_id IS NULL THEN
    RAISE EXCEPTION 'Referral not found';
  END IF;

  IF v_role = 'marketing' AND v_referral_marketer_id <> v_caller THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    r.id AS referral_id,
    r.referral_code,
    r.referred_user_id,
    r.status::referral_status,
    r.first_seen_at,
    r.registered_at,
    r.converted_at,
    r.created_at,
    p.full_name AS referred_user_full_name,
    p.email AS referred_user_email,
    p.account_status::text AS referred_user_account_status,
    mc.id AS commission_id,
    mc.order_id,
    mc.commission_amount,
    mc.gross_order_amount,
    mc.status::commission_status,
    mc.currency AS commission_currency,
    mc.created_at AS commission_created_at
  FROM marketing_referrals r
  LEFT JOIN profiles p ON r.referred_user_id = p.id
  LEFT JOIN marketing_commissions mc ON mc.referral_id = r.id
    AND (v_role = 'admin' OR mc.marketer_id = v_caller)
  WHERE r.id = p_referral_id
  ORDER BY mc.created_at DESC NULLS LAST;
END;
$function$;

REVOKE EXECUTE ON FUNCTION get_marketer_referral_detail(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION get_marketer_referral_detail(uuid) TO authenticated;

-- ============================================================
-- 3. get_marketer_commissions — fix ambiguous column references
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_marketer_commissions(
  p_status_filter text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date,
  p_limit integer DEFAULT 10,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  marketer_id uuid,
  referred_user_id uuid,
  referral_id uuid,
  order_id uuid,
  payment_id uuid,
  gross_order_amount numeric,
  platform_fee_amount numeric,
  commission_base_value numeric,
  commission_rate numeric,
  commission_amount numeric,
  commission_base_type commission_base,
  currency text,
  status commission_status,
  created_at timestamp with time zone,
  approved_at timestamp with time zone,
  paid_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  cancellation_reason text,
  order_number text,
  order_status text,
  order_created_at timestamp with time zone,
  referral_code text,
  referred_user_name text,
  referred_user_email text,
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
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT pr.role INTO v_role FROM profiles pr WHERE pr.id = v_caller;
  IF v_role NOT IN ('marketing', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      mc.id,
      mc.marketer_id,
      mc.referred_user_id,
      mc.referral_id,
      mc.order_id,
      mc.payment_id,
      mc.gross_order_amount,
      mc.platform_fee_amount,
      mc.commission_base_value,
      mc.commission_rate,
      mc.commission_amount,
      mc.commission_base_type,
      mc.currency,
      mc.status,
      mc.created_at,
      mc.approved_at,
      mc.paid_at,
      mc.cancelled_at,
      mc.cancellation_reason,
      o.order_number,
      o.status::text AS order_status,
      o.created_at AS order_created_at,
      r.referral_code,
      p.full_name AS referred_user_name,
      p.email AS referred_user_email
    FROM marketing_commissions mc
    LEFT JOIN orders o ON mc.order_id = o.id
    LEFT JOIN marketing_referrals r ON mc.referral_id = r.id
    LEFT JOIN profiles p ON mc.referred_user_id = p.id
    WHERE
      (v_role = 'admin' OR mc.marketer_id = v_caller)
      AND (
        p_status_filter IS NULL
        OR p_status_filter = 'all'
        OR mc.status::text = p_status_filter
      )
      AND (
        p_start_date IS NULL
        OR mc.created_at >= p_start_date::timestamptz
      )
      AND (
        p_end_date IS NULL
        OR mc.created_at < (p_end_date + interval '1 day')::timestamptz
      )
      AND (
        p_search IS NULL
        OR trim(p_search) = ''
        OR o.order_number ILIKE '%' || trim(p_search) || '%'
        OR p.full_name ILIKE '%' || trim(p_search) || '%'
        OR p.email ILIKE '%' || trim(p_search) || '%'
        OR r.referral_code ILIKE '%' || trim(p_search) || '%'
      )
  ),
  counted AS (
    SELECT b.*, COUNT(*) OVER() AS total_count FROM base b
  )
  SELECT
    c.id,
    c.marketer_id,
    c.referred_user_id,
    c.referral_id,
    c.order_id,
    c.payment_id,
    c.gross_order_amount,
    c.platform_fee_amount,
    c.commission_base_value,
    c.commission_rate,
    c.commission_amount,
    c.commission_base_type,
    c.currency,
    c.status::commission_status,
    c.created_at,
    c.approved_at,
    c.paid_at,
    c.cancelled_at,
    c.cancellation_reason,
    c.order_number,
    c.order_status,
    c.order_created_at,
    c.referral_code,
    c.referred_user_name,
    c.referred_user_email,
    c.total_count
  FROM counted c
  ORDER BY c.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

REVOKE EXECUTE ON FUNCTION get_marketer_commissions(text, text, date, date, int, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION get_marketer_commissions(text, text, date, date, int, int) TO authenticated;

-- ============================================================
-- 4. get_marketing_completed_orders — fix ambiguous column references
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_marketing_completed_orders()
RETURNS TABLE(
  id uuid,
  order_number text,
  status text,
  pickup_location text,
  delivery_location text,
  agreed_weight_kg numeric,
  created_at timestamp with time zone,
  completed_at timestamp with time zone,
  product_name text,
  origin text,
  destination text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_marketer_filter uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT pr.role INTO v_role FROM profiles pr WHERE pr.id = v_caller;
  IF v_role NOT IN ('marketing', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_marketer_filter := CASE WHEN v_role = 'marketing' THEN v_caller ELSE NULL END;

  RETURN QUERY
  SELECT DISTINCT
    o.id,
    o.order_number,
    o.status::text,
    o.pickup_location,
    o.delivery_location,
    o.agreed_weight_kg,
    o.created_at,
    o.completed_at,
    sl.product_name,
    t.origin,
    t.destination
  FROM orders o
  INNER JOIN marketing_commissions mc ON mc.order_id = o.id
    AND (v_marketer_filter IS NULL OR mc.marketer_id = v_marketer_filter)
  LEFT JOIN sender_listings sl ON o.sender_listing_id = sl.id
  LEFT JOIN trips t ON o.trip_id = t.id
  WHERE o.status = 'completed'
  ORDER BY o.completed_at DESC NULLS LAST, o.created_at DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION get_marketing_completed_orders() FROM anon;
GRANT EXECUTE ON FUNCTION get_marketing_completed_orders() TO authenticated;

-- ============================================================
-- 5. get_marketer_payouts — fix ambiguous column references
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_marketer_payouts(
  p_status_filter text DEFAULT NULL::text,
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date,
  p_limit integer DEFAULT 10,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  marketer_id uuid,
  amount numeric,
  currency text,
  status text,
  payout_method text,
  payout_reference text,
  commission_ids uuid[],
  created_at timestamp with time zone,
  completed_at timestamp with time zone,
  completed_by uuid,
  completed_by_name text,
  notes text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_marketer_filter uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT pr.role INTO v_role FROM profiles pr WHERE pr.id = v_caller;
  IF v_role NOT IN ('marketing', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_marketer_filter := CASE WHEN v_role = 'marketing' THEN v_caller ELSE NULL END;

  RETURN QUERY
  WITH base AS (
    SELECT
      mp.id,
      mp.marketer_id,
      mp.amount,
      mp.currency,
      mp.status,
      mp.payout_method,
      mp.payout_reference,
      mp.commission_ids,
      mp.created_at,
      mp.completed_at,
      mp.completed_by,
      p.full_name AS completed_by_name,
      mp.notes
    FROM marketing_payouts mp
    LEFT JOIN profiles p ON mp.completed_by = p.id
    WHERE
      (v_marketer_filter IS NULL OR mp.marketer_id = v_marketer_filter)
      AND (
        p_status_filter IS NULL
        OR p_status_filter = 'all'
        OR mp.status = p_status_filter
      )
      AND (
        p_start_date IS NULL
        OR mp.created_at >= p_start_date::timestamptz
      )
      AND (
        p_end_date IS NULL
        OR mp.created_at < (p_end_date + interval '1 day')::timestamptz
      )
  ),
  counted AS (
    SELECT b.*, COUNT(*) OVER() AS total_count FROM base b
  )
  SELECT
    c.id,
    c.marketer_id,
    c.amount,
    c.currency,
    c.status,
    c.payout_method,
    c.payout_reference,
    c.commission_ids,
    c.created_at,
    c.completed_at,
    c.completed_by,
    c.completed_by_name,
    c.notes,
    c.total_count
  FROM counted c
  ORDER BY c.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

REVOKE EXECUTE ON FUNCTION get_marketer_payouts(text, date, date, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION get_marketer_payouts(text, date, date, int, int) TO authenticated;

-- ============================================================
-- 6. get_marketer_payouts_summary — fix ambiguous column references
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_marketer_payouts_summary()
RETURNS TABLE(
  currency text,
  total_paid numeric,
  total_pending numeric,
  available_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_marketer_filter uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT pr.role INTO v_role FROM profiles pr WHERE pr.id = v_caller;
  IF v_role NOT IN ('marketing', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_marketer_filter := CASE WHEN v_role = 'marketing' THEN v_caller ELSE NULL END;

  RETURN QUERY
  WITH payout_totals AS (
    SELECT
      mp.currency AS p_currency,
      COALESCE(SUM(CASE WHEN mp.status = 'completed' THEN mp.amount ELSE 0 END), 0) AS total_paid,
      COALESCE(SUM(CASE WHEN mp.status = 'pending' THEN mp.amount ELSE 0 END), 0) AS total_pending
    FROM marketing_payouts mp
    WHERE (v_marketer_filter IS NULL OR mp.marketer_id = v_marketer_filter)
    GROUP BY mp.currency
  ),
  commission_available AS (
    SELECT
      mc.currency AS c_currency,
      COALESCE(SUM(mc.commission_amount), 0) AS available
    FROM marketing_commissions mc
    WHERE (v_marketer_filter IS NULL OR mc.marketer_id = v_marketer_filter)
    AND mc.status = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM marketing_payouts mp2
      WHERE mp2.commission_ids @> ARRAY[mc.id]
      AND mp2.status = 'completed'
    )
    GROUP BY mc.currency
  )
  SELECT
    COALESCE(pt.p_currency, ca.c_currency) AS currency,
    COALESCE(pt.total_paid, 0) AS total_paid,
    COALESCE(pt.total_pending, 0) AS total_pending,
    COALESCE(ca.available, 0) AS available_balance
  FROM payout_totals pt
  FULL OUTER JOIN commission_available ca ON pt.p_currency = ca.c_currency;
END;
$function$;

REVOKE EXECUTE ON FUNCTION get_marketer_payouts_summary() FROM anon;
GRANT EXECUTE ON FUNCTION get_marketer_payouts_summary() TO authenticated;

-- ============================================================
-- 7. get_marketer_analytics — fix nested aggregate + ambiguous columns
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_marketer_analytics(
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_start date;
  v_end date;
  v_kpis jsonb;
  v_commission_summary jsonb;
  v_referral_timeseries jsonb;
  v_commission_timeseries jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT pr.role INTO v_role FROM profiles pr WHERE pr.id = v_caller;
  IF v_role NOT IN ('marketing', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_end := COALESCE(p_end_date, CURRENT_DATE);
  v_start := COALESCE(p_start_date, v_end - 29);

  IF v_start > v_end THEN
    RAISE EXCEPTION 'Start date cannot be after end date';
  END IF;

  -- KPIs (all-time totals + period counts)
  SELECT jsonb_build_object(
    'total_referrals', COUNT(*),
    'registered', COUNT(*) FILTER (WHERE r.status IN ('registered', 'converted')),
    'converted', COUNT(*) FILTER (WHERE r.status = 'converted'),
    'not_converted', COUNT(*) FILTER (WHERE r.status IN ('attributed', 'registered')),
    'expired', COUNT(*) FILTER (WHERE r.status = 'expired'),
    'conversion_rate', CASE
      WHEN COUNT(*) FILTER (WHERE r.status IN ('registered', 'converted')) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE r.status = 'converted')::numeric /
        COUNT(*) FILTER (WHERE r.status IN ('registered', 'converted')) * 100, 2
      )
      ELSE 0
    END,
    'period_referrals', COUNT(*) FILTER (WHERE r.created_at >= v_start AND r.created_at < v_end + 1),
    'period_registrations', COUNT(*) FILTER (
      WHERE r.created_at >= v_start AND r.created_at < v_end + 1
      AND r.status IN ('registered', 'converted')
    ),
    'period_conversions', COUNT(*) FILTER (
      WHERE r.created_at >= v_start AND r.created_at < v_end + 1
      AND r.status = 'converted'
    )
  ) INTO v_kpis
  FROM marketing_referrals r
  WHERE (v_role = 'admin' OR r.marketer_id = v_caller);

  -- Commission summary grouped by currency (use CTE to avoid nested aggregate)
  SELECT COALESCE(jsonb_object_agg(
    cs.currency,
    jsonb_build_object(
      'total', cs.total,
      'pending', cs.pending,
      'approved', cs.approved,
      'paid', cs.paid,
      'reversed', cs.reversed,
      'cancelled', cs.cancelled,
      'count', cs.count
    )
  ), '{}'::jsonb)
  INTO v_commission_summary
  FROM (
    SELECT
      mc.currency,
      COALESCE(SUM(mc.commission_amount) FILTER (WHERE mc.status IN ('pending', 'approved', 'paid')), 0) AS total,
      COALESCE(SUM(mc.commission_amount) FILTER (WHERE mc.status = 'pending'), 0) AS pending,
      COALESCE(SUM(mc.commission_amount) FILTER (WHERE mc.status = 'approved'), 0) AS approved,
      COALESCE(SUM(mc.commission_amount) FILTER (WHERE mc.status = 'paid'), 0) AS paid,
      COALESCE(SUM(mc.commission_amount) FILTER (WHERE mc.status = 'reversed'), 0) AS reversed,
      COALESCE(SUM(mc.commission_amount) FILTER (WHERE mc.status = 'cancelled'), 0) AS cancelled,
      COUNT(*) AS count
    FROM marketing_commissions mc
    WHERE (v_role = 'admin' OR mc.marketer_id = v_caller)
    GROUP BY mc.currency
  ) cs;

  -- Referral timeseries
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_referral_timeseries
  FROM (
    SELECT
      d::text AS date,
      COUNT(r.id) AS referrals,
      COUNT(r.id) FILTER (WHERE r.status IN ('registered', 'converted')) AS registrations,
      COUNT(r.id) FILTER (WHERE r.status = 'converted') AS conversions
    FROM generate_series(v_start, v_end, interval '1 day') AS d
    LEFT JOIN marketing_referrals r
      ON r.marketer_id = CASE WHEN v_role = 'admin' THEN r.marketer_id ELSE v_caller END
      AND r.created_at >= d
      AND r.created_at < d + interval '1 day'
    GROUP BY d
  ) t;

  -- Commission timeseries
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_commission_timeseries
  FROM (
    SELECT
      d::text AS date,
      COALESCE(SUM(c.commission_amount) FILTER (WHERE c.status IN ('pending', 'approved', 'paid')), 0) AS amount,
      COALESCE((array_agg(c.currency) FILTER (WHERE c.status IN ('pending', 'approved', 'paid')))[1], 'EGP') AS currency
    FROM generate_series(v_start, v_end, interval '1 day') AS d
    LEFT JOIN marketing_commissions c
      ON c.marketer_id = CASE WHEN v_role = 'admin' THEN c.marketer_id ELSE v_caller END
      AND c.created_at >= d
      AND c.created_at < d + interval '1 day'
    GROUP BY d
  ) t;

  RETURN jsonb_build_object(
    'kpis', v_kpis,
    'commission_summary', v_commission_summary,
    'referral_timeseries', v_referral_timeseries,
    'commission_timeseries', v_commission_timeseries,
    'date_range', jsonb_build_object('start', v_start, 'end', v_end)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION get_marketer_analytics(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_marketer_analytics(date, date) TO authenticated;
