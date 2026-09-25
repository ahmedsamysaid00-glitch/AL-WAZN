/*
# Fix: guard_order_financial_fields references nonexistent "amount" column

## Problem
The `guard_order_financial_fields` trigger function references `OLD.amount`
and `NEW.amount`, but the `orders` table has no `amount` column.
The correct column name is `agreed_price`.

This trigger fires BEFORE UPDATE on orders, so every order update fails
with a "column 'amount' does not exist" error, breaking the entire order
lifecycle: acceptance, payment, delivery, completion, cancellation.

## Root Cause
Migration 0058 created `guard_order_financial_fields` using `amount`
instead of `agreed_price`. The previous audit (0082) fixed the analogous
bug in `guard_collab_financial_fields` (which referenced nonexistent
`collaborations.currency`) but missed this one.

## Fix
Replace `amount` with `agreed_price` in the guard function.
Also protect `platform_fee`, `total_amount`, and `agreed_weight_kg`
since these are financial fields that should be immutable after creation.
*/
CREATE OR REPLACE FUNCTION public.guard_order_financial_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
IF OLD.agreed_price <> NEW.agreed_price THEN
RAISE EXCEPTION 'Cannot modify order agreed_price' USING ERRCODE = '42501';
END IF;
IF OLD.currency <> NEW.currency THEN
RAISE EXCEPTION 'Cannot modify order currency' USING ERRCODE = '42501';
END IF;
IF OLD.platform_fee <> NEW.platform_fee THEN
RAISE EXCEPTION 'Cannot modify order platform_fee' USING ERRCODE = '42501';
END IF;
IF OLD.total_amount <> NEW.total_amount THEN
RAISE EXCEPTION 'Cannot modify order total_amount' USING ERRCODE = '42501';
END IF;
IF OLD.agreed_weight_kg <> NEW.agreed_weight_kg THEN
RAISE EXCEPTION 'Cannot modify order agreed_weight_kg' USING ERRCODE = '42501';
END IF;
RETURN NEW;
END;
$function$;
