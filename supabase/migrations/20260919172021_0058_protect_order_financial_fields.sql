/*
# Protect Order Financial Fields

## Problem
The `orders` UPDATE RLS policy allows the sender or traveler to update any column
on their order rows. The existing `guard_order_status_transition` trigger validates
status changes but does NOT prevent a sender or traveler from directly modifying
financial fields (`total_amount`, `platform_fee`, `agreed_price`, `currency`) via
a direct database/API UPDATE, bypassing the React UI.

## Solution
Add a new BEFORE UPDATE trigger function `guard_order_financial_fields()` that:
1. Detects changes to `total_amount`, `platform_fee`, `agreed_price`, or `currency`.
2. Allows the change if the caller is an admin (via `is_admin()`).
3. Allows the change if the `app.bypass_guard` session variable is set to `'on'`
   (same pattern used by `guard_profile_fields` for trusted SECURITY DEFINER RPCs).
4. Rejects the change for all other callers (senders, travelers, anon).
5. If no financial fields are changing, returns `NEW` immediately (no overhead).

## Why this is safe
- No existing SECURITY DEFINER RPC ever UPDATEs financial fields on orders.
  They only UPDATE `status` and timestamp columns.
- `create_order_from_collaboration` only INSERTs (BEFORE UPDATE does not fire).
- `accept_order` only sets `status` and `traveler_confirmed_at`.
- `hold_payment` / `complete_payment` only set `status = 'confirmed'`.
- The `app.bypass_guard` session variable provides an escape hatch for future
  admin RPCs that may legitimately need to adjust financial fields, matching
  the existing convention used by `guard_profile_fields` and
  `guard_verification_request_fields`.

## Protected fields
- `total_amount` — total order value (agreed price + platform fee)
- `platform_fee` — platform commission amount
- `agreed_price` — negotiated price between sender and traveler
- `currency` — order currency (USD or EGP)

## What still works
- Sender/traveler status transitions (pending → awaiting_payment → confirmed →
  in_transit → delivered → received → completed → cancelled)
- All existing RPCs (accept_order, initiate_payment, hold_payment,
  complete_payment, release_payment, request_refund, process_refund,
  create_order_from_collaboration)
- Admin updates to any field (is_admin() check)
- Notification and tracking triggers (AFTER UPDATE, unaffected)

## Trigger
- `order_guard_financial` — BEFORE UPDATE ON orders FOR EACH ROW
- Executes before `order_guard_status` and `order_guard_ownership` (alphabetical
  trigger naming ensures `order_guard_financial` runs before
  `order_guard_ownership` and `order_guard_status`)

## Security changes
- No RLS policy changes.
- No role/grant changes.
- New trigger function `guard_order_financial_fields()` (SECURITY INVOKER,
  matching existing guard functions).
*/

-- ----------------------------------------------------------------------------
-- 1. Create the guard function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_order_financial_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
    -- If no financial fields are changing, pass through immediately.
    -- This keeps the trigger zero-cost for legitimate status-only updates.
    IF NEW.total_amount IS NOT DISTINCT FROM OLD.total_amount
       AND NEW.platform_fee IS NOT DISTINCT FROM OLD.platform_fee
       AND NEW.agreed_price IS NOT DISTINCT FROM OLD.agreed_price
       AND NEW.currency IS NOT DISTINCT FROM OLD.currency
    THEN
        RETURN NEW;
    END IF;

    -- Allow admin to modify financial fields.
    IF public.is_admin() THEN
        RETURN NEW;
    END IF;

    -- Allow trusted SECURITY DEFINER RPCs that set the bypass session variable.
    -- This matches the convention used by guard_profile_fields and
    -- guard_verification_request_fields.
    IF current_setting('app.bypass_guard', true) = 'on' THEN
        RETURN NEW;
    END IF;

    -- Block the change for everyone else (senders, travelers, anon).
    RAISE EXCEPTION 'Cannot modify order financial fields (total_amount, platform_fee, agreed_price, currency) directly';
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Create the BEFORE UPDATE trigger
--    Named to sort before the existing order_guard_ownership and
--    order_guard_status triggers (PostgreSQL fires alphabetically when
--    multiple BEFORE UPDATE triggers exist on the same table).
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS order_guard_financial ON public.orders;

CREATE TRIGGER order_guard_financial
    BEFORE UPDATE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_order_financial_fields();
