
-- Fix guard_ledger_immutable: remove reference to non-existent column balance_after
CREATE OR REPLACE FUNCTION public.guard_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS NULL AND OLD.user_id IS NOT NULL
       AND NEW.id = OLD.id
       AND NEW.order_id IS NOT DISTINCT FROM OLD.order_id
       AND NEW.payment_id IS NOT DISTINCT FROM OLD.payment_id
       AND NEW.entry_type = OLD.entry_type
       AND NEW.direction = OLD.direction
       AND NEW.amount = OLD.amount
       AND NEW.currency = OLD.currency
       AND NEW.description IS NOT DISTINCT FROM OLD.description
       AND NEW.created_at = OLD.created_at
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Financial ledger entries are immutable and cannot be modified';
  END IF;

  RAISE EXCEPTION 'Financial ledger entries are immutable and cannot be modified';
END;
$function$;
