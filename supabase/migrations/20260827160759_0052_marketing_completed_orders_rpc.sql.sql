-- Security definer function that returns ONLY completed orders with NON-FINANCIAL columns only.
-- The marketing role must not access financial columns (agreed_price, platform_fee, total_amount).
-- RLS on orders restricts rows to participants/admin; this function bypasses RLS to let the
-- marketer see completed orders platform-wide, but exposes only safe columns.

CREATE OR REPLACE FUNCTION get_marketing_completed_orders()
RETURNS TABLE (
  id uuid,
  order_number text,
  status text,
  pickup_location text,
  delivery_location text,
  agreed_weight_kg numeric,
  created_at timestamptz,
  completed_at timestamptz,
  product_name text,
  origin text,
  destination text
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Only the marketing role may call this
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'marketing'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
    SELECT
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
    LEFT JOIN sender_listings sl ON o.sender_listing_id = sl.id
    LEFT JOIN trips t ON o.trip_id = t.id
    WHERE o.status = 'completed'
    ORDER BY o.completed_at DESC NULLS LAST, o.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_marketing_completed_orders FROM anon;
GRANT EXECUTE ON FUNCTION get_marketing_completed_orders TO authenticated;