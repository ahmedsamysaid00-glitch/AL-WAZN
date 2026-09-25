/*
# Marketing Analytics RPC

Provides a SECURITY DEFINER function that lets a marketer fetch aggregated
analytics for their own referral and commission data.

## Security
- SECURITY DEFINER — bypasses RLS to read marketing_commissions (admin-only)
- Scoped to auth.uid() as marketer_id
- Revoked from anon and PUBLIC, granted to authenticated
- Role check: caller must be 'marketing' or 'admin'

## Indexes
Composite indexes on (marketer_id, created_at DESC) for date-range queries.
*/

CREATE INDEX IF NOT EXISTS idx_marketing_referrals_marketer_created
  ON marketing_referrals (marketer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_commissions_marketer_created
  ON marketing_commissions (marketer_id, created_at DESC);

CREATE OR REPLACE FUNCTION get_marketer_analytics(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT role INTO v_role FROM profiles WHERE id = v_caller;
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
    'registered', COUNT(*) FILTER (WHERE status IN ('registered', 'converted')),
    'converted', COUNT(*) FILTER (WHERE status = 'converted'),
    'not_converted', COUNT(*) FILTER (WHERE status IN ('attributed', 'registered')),
    'expired', COUNT(*) FILTER (WHERE status = 'expired'),
    'conversion_rate', CASE
      WHEN COUNT(*) FILTER (WHERE status IN ('registered', 'converted')) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE status = 'converted')::numeric /
        COUNT(*) FILTER (WHERE status IN ('registered', 'converted')) * 100, 2
      )
      ELSE 0
    END,
    'period_referrals', COUNT(*) FILTER (WHERE created_at >= v_start AND created_at < v_end + 1),
    'period_registrations', COUNT(*) FILTER (
      WHERE created_at >= v_start AND created_at < v_end + 1
      AND status IN ('registered', 'converted')
    ),
    'period_conversions', COUNT(*) FILTER (
      WHERE created_at >= v_start AND created_at < v_end + 1
      AND status = 'converted'
    )
  ) INTO v_kpis
  FROM marketing_referrals
  WHERE (v_role = 'admin' OR marketer_id = v_caller);

  -- Commission summary grouped by currency
  SELECT COALESCE(jsonb_object_agg(
    currency,
    jsonb_build_object(
      'total', COALESCE(SUM(commission_amount) FILTER (WHERE status IN ('pending', 'approved', 'paid')), 0),
      'pending', COALESCE(SUM(commission_amount) FILTER (WHERE status = 'pending'), 0),
      'approved', COALESCE(SUM(commission_amount) FILTER (WHERE status = 'approved'), 0),
      'paid', COALESCE(SUM(commission_amount) FILTER (WHERE status = 'paid'), 0),
      'reversed', COALESCE(SUM(commission_amount) FILTER (WHERE status = 'reversed'), 0),
      'cancelled', COALESCE(SUM(commission_amount) FILTER (WHERE status = 'cancelled'), 0),
      'count', COUNT(*)
    )
  ), '{}'::jsonb)
  INTO v_commission_summary
  FROM marketing_commissions
  WHERE (v_role = 'admin' OR marketer_id = v_caller)
  GROUP BY currency;

  -- Referral timeseries (generate_series preserves order naturally)
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
$$;

REVOKE EXECUTE ON FUNCTION get_marketer_analytics(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_marketer_analytics(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_marketer_analytics(date, date) TO authenticated;
