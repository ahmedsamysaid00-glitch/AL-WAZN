/*
# Fix guard triggers to allow user FK NULLification during admin user deletion
#
## Problem
Four guard triggers block ALL updates to user FK columns on financial tables:
  - guard_ledger_immutable()  → blocks UPDATE on financial_ledger_entries (including user_id)
  - guard_payment_ownership() → blocks changing payer_id, payee_id on payments
  - guard_refund_ownership()  → blocks changing requested_by on refunds
  - guard_wallet_ownership()   → blocks changing user_id on wallet_accounts
#
## Fix
Allow ONLY the specific user FK column to transition from non-NULL to NULL
(anonymization during admin user deletion). All other protections remain intact.
*/

-- 1. guard_ledger_immutable: allow user_id NULLification only
CREATE OR REPLACE FUNCTION public.guard_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Allow only NULLification of user_id (admin user deletion anonymization)
    IF NEW.user_id IS NULL AND OLD.user_id IS NOT NULL
       AND NEW.id = OLD.id
       AND NEW.order_id = OLD.order_id
       AND NEW.payment_id IS NOT DISTINCT FROM OLD.payment_id
       AND NEW.entry_type = OLD.entry_type
       AND NEW.amount = OLD.amount
       AND NEW.currency = OLD.currency
       AND NEW.balance_after IS NOT DISTINCT FROM OLD.balance_after
       AND NEW.description IS NOT DISTINCT FROM OLD.description
       AND NEW.created_at = OLD.created_at
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Financial ledger entries are immutable and cannot be modified';
  END IF;

  -- For DELETE: always block
  RAISE EXCEPTION 'Financial ledger entries are immutable and cannot be modified';
END;
$function$;

-- 2. guard_payment_ownership: allow payer_id/payee_id NULLification only
CREATE OR REPLACE FUNCTION public.guard_payment_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'Cannot change order_id on a payment';
  END IF;
  -- Allow payer_id NULLification (admin user deletion) but block arbitrary changes
  IF NEW.payer_id IS DISTINCT FROM OLD.payer_id AND NOT (NEW.payer_id IS NULL AND OLD.payer_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot change payer_id on a payment';
  END IF;
  -- Allow payee_id NULLification (admin user deletion) but block arbitrary changes
  IF NEW.payee_id IS DISTINCT FROM OLD.payee_id AND NOT (NEW.payee_id IS NULL AND OLD.payee_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot change payee_id on a payment';
  END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'Cannot change amount on a payment';
  END IF;
  IF NEW.platform_fee IS DISTINCT FROM OLD.platform_fee THEN
    RAISE EXCEPTION 'Cannot change platform_fee on a payment';
  END IF;
  IF NEW.net_amount IS DISTINCT FROM OLD.net_amount THEN
    RAISE EXCEPTION 'Cannot change net_amount on a payment';
  END IF;
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'Cannot change currency on a payment';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Cannot change created_at on a payment';
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. guard_refund_ownership: allow requested_by NULLification only
CREATE OR REPLACE FUNCTION public.guard_refund_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.payment_id IS DISTINCT FROM OLD.payment_id THEN
    RAISE EXCEPTION 'Cannot change payment_id on a refund';
  END IF;
  IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'Cannot change order_id on a refund';
  END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'Cannot change amount on a refund';
  END IF;
  -- Allow requested_by NULLification (admin user deletion) but block arbitrary changes
  IF NEW.requested_by IS DISTINCT FROM OLD.requested_by AND NOT (NEW.requested_by IS NULL AND OLD.requested_by IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot change requested_by on a refund';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Cannot change created_at on a refund';
  END IF;
  RETURN NEW;
END;
$function$;

-- 4. guard_wallet_ownership: allow user_id NULLification only
CREATE OR REPLACE FUNCTION public.guard_wallet_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow user_id NULLification (admin user deletion) but block arbitrary changes
  IF NEW.user_id IS DISTINCT FROM OLD.user_id AND NOT (NEW.user_id IS NULL AND OLD.user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot change user_id on a wallet account';
  END IF;
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'Cannot change currency on a wallet account';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Cannot change created_at on a wallet account';
  END IF;
  RETURN NEW;
END;
$function$;
