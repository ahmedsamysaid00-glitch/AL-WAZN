/*
# Marketer Commissions RPC

## Purpose
Provides a SECURITY DEFINER function that lets a marketer browse their full
commission history with safe order and referral columns — without requiring
direct SELECT access to marketing_commissions (admin-only per migration 0050),
orders, or profiles.

## Why
- marketing_commissions RLS is admin-only (migration 0050 revoked marketer
  access). The Dashboard's direct query returns zero rows for marketers.
- The Referrals page shows per-referral commissions via the detail RPC, but
  there is no dedicated page to browse all commissions with filtering.
- This RPC fills that gap with a paginated, filterable commission list.

## What this RPC returns
A table of commissions with:
- Commission columns: id, status, commission_amount, gross_order_amount,
  platform_fee_amount, commission_base_value, commission_rate,
  commission_base_type, currency, created_at, approved_at, paid_at,
  cancelled_at, cancellation_reason
- Order columns: order_number, order_status, order_created_at
- Referral columns: referral_id, referred_user_name, referred_user_email

## Security
- SECURITY DEFINER — bypasses RLS to read marketing_commissions, orders, profiles
- Scoped to auth.uid() as marketer_id — a marketer only sees their own commissions
- Admin sees all commissions
- Only exposes non-sensitive profile columns (full_name, email)
- Revoked from anon and public, granted to authenticated
- Role check: caller must have role = 'marketing' or 'admin'
- Server-side filtering by status, date range, and search
- Server-side pagination with total_count
*/

CREATE OR REPLACE FUNCTION get_marketer_commissions(
  p_status_filter text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_limit int DEFAULT 10,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
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
  created_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  order_number text,
  order_status text,
  order_created_at timestamptz,
  referral_code text,
  referred_user_name text,
  referred_user_email text,
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
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_caller;
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
$$;

REVOKE EXECUTE ON FUNCTION get_marketer_commissions(text, text, date, date, int, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION get_marketer_commissions(text, text, date, date, int, int) TO authenticated;
