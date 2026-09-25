/*
# Fix: Revoke anon execute on initiate_payment

## Changes
- REVOKE EXECUTE on initiate_payment FROM anon
- Ensure only authenticated can execute
*/

REVOKE EXECUTE ON FUNCTION initiate_payment(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION request_refund(uuid, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION get_active_fee_config() FROM anon;
REVOKE EXECUTE ON FUNCTION get_payment_stats() FROM anon;

-- Ensure authenticated still has access
GRANT EXECUTE ON FUNCTION initiate_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION request_refund(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_fee_config() TO authenticated;
GRANT EXECUTE ON FUNCTION get_payment_stats() TO authenticated;
