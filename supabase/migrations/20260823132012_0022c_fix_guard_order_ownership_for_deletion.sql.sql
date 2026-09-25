/*
# Fix guard_order_ownership trigger to allow admin user deletion

## Root Cause
The `guard_order_ownership()` trigger blocks ANY update to orders.sender_id,
orders.traveler_id, orders.collaboration_id, orders.trip_id, and orders.sender_listing_id.
This prevents `admin_delete_user` from nullifying these columns before deleting the user.

## Fix
Modify `guard_order_ownership()` to allow setting these columns to NULL when the
old value is non-NULL and the new value is NULL. This only permits NULLification
(anonymization for user deletion), not arbitrary changes.

The check becomes: block the change UNLESS the new value is NULL and old was non-NULL.
This preserves the original protection (users can't swap to a different collaboration/trip/etc.)
while allowing the admin deletion RPC to anonymize order references.
*/

CREATE OR REPLACE FUNCTION public.guard_order_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow NULLification (for admin user deletion anonymization) but block arbitrary changes
  IF NEW.collaboration_id IS DISTINCT FROM OLD.collaboration_id AND NOT (NEW.collaboration_id IS NULL AND OLD.collaboration_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot change collaboration_id on an existing order';
  END IF;
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id AND NOT (NEW.trip_id IS NULL AND OLD.trip_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot change trip_id on an existing order';
  END IF;
  IF NEW.sender_listing_id IS DISTINCT FROM OLD.sender_listing_id AND NOT (NEW.sender_listing_id IS NULL AND OLD.sender_listing_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot change sender_listing_id on an existing order';
  END IF;
  IF NEW.traveler_id IS DISTINCT FROM OLD.traveler_id AND NOT (NEW.traveler_id IS NULL AND OLD.traveler_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot change traveler_id on an existing order';
  END IF;
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id AND NOT (NEW.sender_id IS NULL AND OLD.sender_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot change sender_id on an existing order';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Cannot change created_at on an existing order';
  END IF;
  IF NEW.order_number IS DISTINCT FROM OLD.order_number THEN
    RAISE EXCEPTION 'Cannot change order_number on an existing order';
  END IF;
  RETURN NEW;
END;
$function$;
