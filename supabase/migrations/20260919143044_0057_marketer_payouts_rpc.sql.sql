/*
# Marketer Payouts RPCs

## Purpose
Provides two SECURITY DEFINER functions that let a marketer view their own
payout history and balance summary — without requiring direct SELECT access
to marketing_payouts or marketing_commissions (admin-only per migration 0050).

## Why
- marketing_payouts RLS is admin-only (migration 0050 revoked marketer
  access). The Dashboard's direct query returns zero rows for marketers.
- No marketer-facing payout RPC existed previously.
- Payouts are created exclusively by the admin-driven pay_commission RPC.
  There is no marketer payout request mechanism. These RPCs are read-only.

## Functions
1. get_marketer_payouts_summary — returns total_paid, total_pending,
   available_balance per currency for the calling marketer
2. get_marketer_payouts — paginated payout history with filters

## Available Balance Formula
Sum of approved commissions (status = 'approved') that are NOT already
included in any completed payout's commission_ids array.
This is the amount eligible for future payout.

## Security
- SECURITY DEFINER — bypasses RLS to read marketing_payouts and
  marketing_commissions
- Scoped to auth.uid() as marketer_id — a marketer only sees their own
  payouts
- Admin sees all payouts
- Revoked from anon and public, granted to authenticated
- Role check: caller must have role = 'marketing' or 'admin'
- Read-only — no INSERT/UPDATE/DELETE
*/

-- ============================================================
-- 1. get_marketer_payouts_summary — balance summary per currency
-- ============================================================

CREATE OR REPLACE FUNCTION get_marketer_payouts_summary()
RETURNS TABLE (
  currency text,
  total_paid numeric,
  total_pending numeric,
  available_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_marketer_filter uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_caller;
  IF v_role NOT IN ('marketing', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_marketer_filter := CASE WHEN v_role = 'marketing' THEN v_caller ELSE NULL END;

  -- Paid amounts from completed payouts, per currency
  -- Pending amounts from pending payouts, per currency
  -- Available balance: approved commissions not in any completed payout
  RETURN QUERY
  WITH payout_totals AS (
    SELECT
      currency,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) AS total_paid,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) AS total_pending
    FROM marketing_payouts
    WHERE (v_marketer_filter IS NULL OR marketer_id = v_marketer_filter)
    GROUP BY currency
  ),
  commission_available AS (
    SELECT
      mc.currency,
      COALESCE(SUM(mc.commission_amount), 0) AS available
    FROM marketing_commissions mc
    WHERE (v_marketer_filter IS NULL OR mc.marketer_id = v_marketer_filter)
      AND mc.status = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM marketing_payouts mp
        WHERE mp.commission_ids @> ARRAY[mc.id]
          AND mp.status = 'completed'
      )
    GROUP BY mc.currency
  )
  SELECT
    COALESCE(pt.currency, ca.currency) AS currency,
    COALESCE(pt.total_paid, 0) AS total_paid,
    COALESCE(pt.total_pending, 0) AS total_pending,
    COALESCE(ca.available, 0) AS available_balance
  FROM payout_totals pt
  FULL OUTER JOIN commission_available ca ON pt.currency = ca.currency;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_marketer_payouts_summary() FROM anon, public;
GRANT EXECUTE ON FUNCTION get_marketer_payouts_summary() TO authenticated;

-- ============================================================
-- 2. get_marketer_payouts — paginated payout history
-- ============================================================

CREATE OR REPLACE FUNCTION get_marketer_payouts(
  p_status_filter text DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_limit int DEFAULT 10,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  marketer_id uuid,
  amount numeric,
  currency text,
  status text,
  payout_method text,
  payout_reference text,
  commission_ids uuid[],
  created_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  completed_by_name text,
  notes text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_marketer_filter uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_caller;
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
$$;

REVOKE EXECUTE ON FUNCTION get_marketer_payouts(text, date, date, int, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION get_marketer_payouts(text, date, date, int, int) TO authenticated;
