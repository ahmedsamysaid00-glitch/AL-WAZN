/*
# Fix: Revoke PUBLIC execute on fee config functions

## Issue
GRANT TO authenticated implicitly grants to PUBLIC, which anon inherits.
The advisor flagged save_fee_config and activate_fee_config as anon-executable.

## Fix
Explicitly REVOKE EXECUTE FROM PUBLIC on both functions.
*/

REVOKE EXECUTE ON FUNCTION save_fee_config(numeric, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION activate_fee_config(uuid) FROM PUBLIC;

-- Re-grant only to authenticated
GRANT EXECUTE ON FUNCTION save_fee_config(numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION activate_fee_config(uuid) TO authenticated;
