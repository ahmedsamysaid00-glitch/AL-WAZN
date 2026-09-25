/*
# Admin Cancel Listing RPC with Audit Logging

## Purpose
Currently, admin product/listing cancellation in AdminProducts.tsx performs a direct
client-side UPDATE on sender_listings (setting status='cancelled'). This bypasses
the audit logging convention used by all other admin destructive actions.

This migration creates a secure, admin-only RPC that performs the same cancellation
atomically with an audit log insert.

## Changes
1. Adds new audit_action enum value: 'listing_cancelled'
2. Creates `admin_cancel_listing(p_listing_id uuid, p_reason text)` RPC:
   - SECURITY DEFINER, search_path = public
   - Verifies auth.uid() is not null
   - Verifies is_admin()
   - Verifies the listing exists and is in a cancellable status (draft/published/matched)
   - Updates status to 'cancelled'
   - Inserts audit_logs record with admin_id, target_user_id (listing sender),
     action='listing_cancelled', entity_type='sender_listing', entity_id, reason
3. Revokes execution from anon/public, grants to authenticated

## Security
- Only authenticated admins can call this function
- is_admin() check enforced inside the function
- Audit log written in the same transaction as the cancellation
- No financial fields or calculations are touched
- No RLS policies changed
- No existing migrations modified
*/

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'listing_cancelled';

CREATE OR REPLACE FUNCTION public.admin_cancel_listing(p_listing_id uuid, p_reason text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid;
  v_listing sender_listings%ROWTYPE;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_listing FROM sender_listings WHERE id = p_listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  IF v_listing.status NOT IN ('draft', 'published', 'matched') THEN
    RAISE EXCEPTION 'Listing is not in a cancellable status';
  END IF;

  UPDATE sender_listings
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_listing_id;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (
    v_admin_id,
    v_listing.sender_id,
    'listing_cancelled'::audit_action,
    'sender_listing',
    p_listing_id,
    COALESCE(trim(p_reason), 'Admin cancelled listing: ' || v_listing.product_name)
  );

  RETURN json_build_object('success', true, 'listing_id', p_listing_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_cancel_listing(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_listing(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_listing(uuid, text) TO authenticated;
