/*
# Protect Collaboration Financial Fields

## Problem
The `collaborations` UPDATE RLS policy allows either the sender or traveler to
update any column on their collaboration rows. The existing
`guard_collab_status_transition` trigger copies `proposed_price` → `agreed_price`
and `proposed_weight_kg` → `agreed_weight_kg` during the pending → accepted
transition, but does NOT prevent a sender or traveler from directly modifying
these agreed financial fields via a direct database/API UPDATE at any other time.

A malicious user could wait until after acceptance and then send:
  UPDATE collaborations SET agreed_price = 0.01 WHERE id = ...;
This would change the negotiated price without the other party's consent.

## Solution
Add a new BEFORE UPDATE trigger `collab_guard_financial` that:
1. Detects changes to `agreed_price` or `agreed_weight_kg`.
2. Allows the change if the caller is an admin (via `is_admin()`).
3. Allows the change if the `app.bypass_guard` session variable is set to `'on'`
   (same pattern used by `guard_profile_fields`, `guard_verification_request_fields`,
   and the order financial-field protection in migration 0058).
4. Rejects the change for all other callers (senders, travelers, anon).
5. If neither financial field is changing, returns `NEW` immediately (zero overhead
   for normal status-only updates).

## Why this is safe for the existing acceptance flow
During the normal pending → accepted transition, the client sends:
  UPDATE collaborations SET status = 'accepted' WHERE id = ...;

The client does NOT set `agreed_price` or `agreed_weight_kg` in this UPDATE.
PostgreSQL fires BEFORE UPDATE triggers alphabetically:
  1. collab_guard_financial  (this migration) — NEW.agreed_price is NULL,
     OLD.agreed_price is NULL → NOT DISTINCT → passes through immediately.
  2. collab_guard_ownership  — checks immutable fields, passes.
  3. collab_guard_status     — sees status change pending→accepted, sets
     NEW.agreed_price := OLD.proposed_price and NEW.agreed_weight_kg :=
     OLD.proposed_weight_kg (only if NEW value is still NULL).
  4. collab_guard_status_auth — checks traveler authorization, passes.
  5. collab_updated_at        — sets updated_at.

Because `collab_guard_financial` fires FIRST and the client-supplied NEW row
still has NULL for agreed fields (unchanged from OLD), the financial guard sees
no change and passes through. The status transition trigger then legitimately
sets the agreed values from the proposed values. The financial guard does not
re-fire, so the trigger-set value is not blocked.

If a malicious traveler tries to send `agreed_price = 0.01` in the acceptance
UPDATE, the financial guard sees NEW.agreed_price (0.01) IS DISTINCT FROM
OLD.agreed_price (NULL) and blocks it — which is MORE secure than the current
behavior (where the status transition trigger would have kept the client-supplied
value).

## Protected fields
- `agreed_price` — the negotiated price between sender and traveler
- `agreed_weight_kg` — the negotiated shipment weight

## What still works
- Collaboration creation (INSERT — BEFORE UPDATE does not fire)
- Pending → accepted transition (agreed fields set by status trigger, not by client)
- Pending → rejected transition
- Pending → cancelled transition
- Accepted → completed transition
- All existing RPCs and triggers
- Admin updates to any field (is_admin() check)
- Updates to non-financial fields (message, status, timestamps)

## Trigger
- `collab_guard_financial` — BEFORE UPDATE ON collaborations FOR EACH ROW
- Named to sort before all existing BEFORE UPDATE triggers (alphabetical):
  collab_guard_financial < collab_guard_ownership < collab_guard_status <
  collab_guard_status_auth < collab_updated_at

## Security changes
- No RLS policy changes.
- No role/grant changes.
- New trigger function `guard_collab_financial_fields()` (SECURITY INVOKER,
  matching existing guard functions).
*/

-- ----------------------------------------------------------------------------
-- 1. Create the guard function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_collab_financial_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
    -- If no financial fields are changing, pass through immediately.
    -- This keeps the trigger zero-cost for legitimate status-only updates
    -- and for the normal acceptance flow where agreed fields remain NULL
    -- until the status transition trigger sets them from proposed values.
    IF NEW.agreed_price IS NOT DISTINCT FROM OLD.agreed_price
       AND NEW.agreed_weight_kg IS NOT DISTINCT FROM OLD.agreed_weight_kg
    THEN
        RETURN NEW;
    END IF;

    -- Allow admin to modify financial fields.
    IF public.is_admin() THEN
        RETURN NEW;
    END IF;

    -- Allow trusted SECURITY DEFINER RPCs that set the bypass session variable.
    -- This matches the convention used by guard_profile_fields,
    -- guard_verification_request_fields, and guard_order_financial_fields.
    IF current_setting('app.bypass_guard', true) = 'on' THEN
        RETURN NEW;
    END IF;

    -- Block the change for everyone else (senders, travelers, anon).
    RAISE EXCEPTION 'Cannot modify collaboration financial fields (agreed_price, agreed_weight_kg) directly';
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Create the BEFORE UPDATE trigger
--    Named to sort before all existing BEFORE UPDATE collaboration triggers
--    so the financial check runs first.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS collab_guard_financial ON public.collaborations;

CREATE TRIGGER collab_guard_financial
    BEFORE UPDATE ON public.collaborations
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_collab_financial_fields();
