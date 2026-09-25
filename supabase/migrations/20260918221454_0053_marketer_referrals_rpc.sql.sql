/*
# Marketer Referrals RPC

## Purpose
Provides a SECURITY DEFINER function that lets a marketer fetch their own
referrals with safe profile columns (full_name, email, account_status) and
commission summaries — without requiring direct SELECT access to
marketing_commissions (admin-only per migration 0050) or profiles
(owner-only per existing RLS).

## Why
- `marketing_referrals` RLS allows marketers to SELECT their own rows, but
  the embedded join to `profiles` (via `referred_user_id`) returns null because
  `profiles` RLS is `auth.uid() = id OR is_admin()` — the marketer cannot read
  other users' profiles.
- `marketing_commissions` RLS is admin-only (migration 0050 revoked marketer
  access). The detail drawer's direct query returns zero rows for marketers.
- PostgREST nested `or` filters on `profiles.email`/`profiles.full_name` do
  not work when the underlying profile rows are RLS-invisible.

## What this RPC returns
A table of referrals with:
- All non-financial referral columns (id, status, dates, referral_code)
- Safe profile columns: referred_user_full_name, referred_user_email,
  referred_user_account_status
- Commission summary: total_commission_amount, commission_count,
  last_commission_date, commission_currency

## Security
- SECURITY DEFINER — bypasses RLS to read profiles and marketing_commissions
- Scoped to `auth.uid()` as marketer_id — a marketer only sees their own referrals
- Only exposes non-sensitive profile columns (full_name, email, account_status)
- Only exposes aggregate commission data (total, count, last date, currency)
  — no individual commission row details
- Revoked from anon, granted to authenticated
- Role check: caller must have role = 'marketing' or 'admin'
- Search is performed server-side with ILIKE on profile columns
- Pagination is server-side with LIMIT/OFFSET
- Total count returned via output parameter

## Detail RPC
A second function returns commissions for a single referral, scoped to the
calling marketer. Exposes per-commission rows with order_id, amounts, status,
and dates — the financial data the marketer needs to see in the detail drawer.
*/

-- ============================================================
-- 1. get_marketer_referrals — paginated list with profile + commission summary
-- ============================================================

CREATE OR REPLACE FUNCTION get_marketer_referrals(
  p_status_filter text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 10,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  marketer_id uuid,
  referral_code text,
  referred_user_id uuid,
  status referral_status,
  first_seen_at timestamptz,
  registered_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  referred_user_full_name text,
  referred_user_email text,
  referred_user_account_status text,
  total_commission_amount numeric,
  commission_count bigint,
  last_commission_date timestamptz,
  commission_currency text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    comm.commission_currency
  FROM counted c
  LEFT JOIN comm ON comm.referral_id = c.id
  ORDER BY c.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_marketer_referrals(text, text, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION get_marketer_referrals(text, text, int, int) TO authenticated;

-- ============================================================
-- 2. get_marketer_referral_detail — commissions for a single referral
-- ============================================================

CREATE OR REPLACE FUNCTION get_marketer_referral_detail(
  p_referral_id uuid
)
RETURNS TABLE (
  -- Referral fields
  referral_id uuid,
  referral_code text,
  referred_user_id uuid,
  status referral_status,
  first_seen_at timestamptz,
  registered_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz,
  -- Profile fields
  referred_user_full_name text,
  referred_user_email text,
  referred_user_account_status text,
  -- Commission fields
  commission_id uuid,
  order_id uuid,
  commission_amount numeric,
  gross_order_amount numeric,
  commission_status commission_status,
  commission_currency text,
  commission_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_referral_marketer_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_caller;
  IF v_role NOT IN ('marketing', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Verify the referral belongs to the caller (unless admin)
  SELECT marketer_id INTO v_referral_marketer_id
  FROM marketing_referrals WHERE id = p_referral_id;

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
$$;

REVOKE EXECUTE ON FUNCTION get_marketer_referral_detail(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION get_marketer_referral_detail(uuid) TO authenticated;
