-- Fix: guard_collab_financial_fields references a non-existent 'currency' column
-- on the collaborations table, causing every UPDATE to fail with error 42703.
-- The collaborations table has never had a currency column — the original
-- migration 0070 added this check erroneously.
-- We recreate the function with only the agreed_price check, which is the
-- actual financial field that exists on the table.

CREATE OR REPLACE FUNCTION public.guard_collab_financial_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.agreed_price <> NEW.agreed_price THEN
    RAISE EXCEPTION 'Cannot modify collaboration agreed_price' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
