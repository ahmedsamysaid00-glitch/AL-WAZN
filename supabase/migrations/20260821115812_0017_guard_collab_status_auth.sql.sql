/*
# Guard Collaboration Status Authorization

## Purpose
Enforce at the database level that only the Traveler can accept or reject
collaboration requests, and only the Sender can cancel them. Previously,
the `collab_update` RLS policy allowed both parties to change the status
field — meaning a Sender could accept their own request, or a Traveler
could cancel a request they received.

## Changes
1. New function `guard_collab_status_auth()` (SECURITY DEFINER, locked
   search_path) that checks `auth.uid()` against the collaboration's
   `traveler_id` / `sender_id` before allowing a status transition.
   - accept/reject → only `traveler_id` (or admin)
   - cancel        → only `sender_id` (or admin)
   - completed     → no restriction (handled by RPC `create_order_from_collaboration`)
   - no status change → always allowed (other field updates pass through)
2. New BEFORE UPDATE trigger `collab_guard_status_auth` on `collaborations`.

## Security
- SECURITY DEFINER with locked `search_path = public`.
- EXECUTE restricted to `authenticated` only (revoked from anon/public).
- Does not bypass RLS — complements the existing `collab_update` policy.
- Existing `guard_collab_ownership` and `guard_collab_status_transition`
  triggers remain unchanged and continue to enforce ownership immutability
  and valid state-machine transitions.
*/

-- ── Authorization guard function ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_collab_status_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- If status is not changing, allow the update (other fields may change)
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Only the traveler (or admin) can accept or reject
  IF NEW.status IN ('accepted', 'rejected')
     AND auth.uid() <> OLD.traveler_id
     AND NOT is_admin()
  THEN
    RAISE EXCEPTION 'Only the traveler can accept or reject this collaboration';
  END IF;

  -- Only the sender (or admin) can cancel
  IF NEW.status = 'cancelled'
     AND auth.uid() <> OLD.sender_id
     AND NOT is_admin()
  THEN
    RAISE EXCEPTION 'Only the sender can cancel this collaboration';
  END IF;

  RETURN NEW;
END;
$$;

-- ── Trigger ──────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS collab_guard_status_auth ON public.collaborations;
CREATE TRIGGER collab_guard_status_auth
BEFORE UPDATE ON public.collaborations
FOR EACH ROW
EXECUTE FUNCTION public.guard_collab_status_auth();

-- ── Restrict EXECUTE to authenticated ─────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.guard_collab_status_auth() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.guard_collab_status_auth() TO authenticated;
