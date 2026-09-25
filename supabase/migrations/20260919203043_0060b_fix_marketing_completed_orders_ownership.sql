/*
# Fix get_marketing_completed_orders RPC — add marketer ownership filter

## Root Cause
The `get_marketing_completed_orders` function returned ALL completed orders in the system
without filtering by the calling marketer's referred users. This caused two problems:
1. Data leak — a marketer could see orders from other marketers' referrals.
2. The RPC may fail or return unexpected data because it queries orders with no
   marketer relationship at all.

## Fix
Join orders → marketing_commissions → marketing_referrals to filter only completed orders
that have a commission record belonging to the calling marketer. This ensures the
marketer only sees completed orders from their own referrals.

## No other changes
- No table changes
- No RLS changes
- No financial logic changes
- Commission calculation, payout logic, and all financial systems are untouched
*/

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

  SELECT role INTO v_role FROM profiles WHERE id = v_caller;
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
