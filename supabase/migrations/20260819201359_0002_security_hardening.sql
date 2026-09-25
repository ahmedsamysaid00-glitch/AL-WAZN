/*
# AL-WAZN Security Hardening

## Purpose
Addresses security advisor findings on the foundation migration:
1. Locks down `search_path` on `is_admin()` and `profiles_set_updated_at()`
2. Revokes EXECUTE on trigger functions (`handle_new_user`, `guard_profile_fields`)
   from `anon` and `authenticated` so they cannot be called via the REST API.
   These are trigger-only functions and should never be invoked directly by clients.

## Changes
- `is_admin()`: added `SET search_path = public`
- `profiles_set_updated_at()`: added `SET search_path = public`
- `REVOKE EXECUTE ON handle_new_user() FROM anon, authenticated`
- `REVOKE EXECUTE ON guard_profile_fields() FROM anon, authenticated`

## Notes
- `handle_new_user` and `guard_profile_fields` remain SECURITY DEFINER (they must
  run with elevated privileges for trigger operations) but are no longer callable
  via `/rest/v1/rpc/...` by unauthenticated or authenticated users.
- Trigger functions are invoked by the database engine, not by client roles, so
  revoking EXECUTE does not affect their trigger behavior.
*/

-- Lock search_path on is_admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Lock search_path on profiles_set_updated_at
CREATE OR REPLACE FUNCTION profiles_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Revoke direct execution on trigger functions from client roles
REVOKE EXECUTE ON FUNCTION handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION guard_profile_fields() FROM anon, authenticated;
