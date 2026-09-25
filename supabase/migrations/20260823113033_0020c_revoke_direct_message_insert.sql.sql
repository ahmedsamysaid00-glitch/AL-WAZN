/*
# Revoke Direct INSERT on Messages Table

## Purpose
Revokes direct INSERT privilege on the `messages` table from `authenticated` and `anon` roles.
This ensures the `send_message` RPC is the ONLY way users can insert messages,
making backend content moderation unavoidable — even if a user calls the Supabase
REST API directly, they cannot bypass the moderation logic.

## Security Changes
- REVOKE INSERT on `messages` from `authenticated` role
- REVOKE INSERT on `messages` from `anon` role
- The `send_message` function (SECURITY DEFINER) still has INSERT access because
  it runs with the owner's (postgres) privileges, which are not affected by this revoke.

## Important Notes
- SELECT, UPDATE, DELETE privileges on `messages` remain unchanged for `authenticated`.
- RLS policies on `messages` remain unchanged and still enforce conversation membership.
- The existing INSERT RLS policy (`msg_insert`) remains in place — it is now effectively
  unreachable for direct user inserts since the INSERT privilege is revoked, but keeping
  the policy provides defense-in-depth.
- The `service_role` retains all privileges (used for admin operations).
*/
REVOKE INSERT ON public.messages FROM authenticated;
REVOKE INSERT ON public.messages FROM anon;
