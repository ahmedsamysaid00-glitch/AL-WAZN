/*
# AL-WAZN Security Hardening — Revoke PUBLIC execute

## Purpose
PostgreSQL grants EXECUTE on functions to PUBLIC by default. Revoking from
anon/authenticated alone is not sufficient — must also revoke from PUBLIC.
These are trigger-only functions and must not be callable via the REST API.

## Changes
- REVOKE EXECUTE ON handle_new_user() FROM PUBLIC
- REVOKE EXECUTE ON guard_profile_fields() FROM PUBLIC
*/

REVOKE EXECUTE ON FUNCTION handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_profile_fields() FROM PUBLIC;
