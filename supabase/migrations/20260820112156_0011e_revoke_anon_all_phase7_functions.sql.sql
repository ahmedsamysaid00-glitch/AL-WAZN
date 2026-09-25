/*
# Fix: Revoke anon execute on all Phase 7 SECURITY DEFINER functions

## Changes
- REVOKE EXECUTE FROM anon on all Phase 7 functions that don't need anon access
- Trigger functions (guard_*, *_set_updated_at, ensure_single_active_fee) should not be callable by anon
- approve_refund, process_refund are admin-only functions
- calculate_platform_fee is internal only
*/

-- Trigger/helper functions - no direct user access needed
REVOKE EXECUTE ON FUNCTION calculate_platform_fee(numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION ensure_single_active_fee() FROM anon;
REVOKE EXECUTE ON FUNCTION fee_set_updated_at() FROM anon;
REVOKE EXECUTE ON FUNCTION guard_ledger_immutable() FROM anon;
REVOKE EXECUTE ON FUNCTION guard_payment_ownership() FROM anon;
REVOKE EXECUTE ON FUNCTION guard_refund_ownership() FROM anon;
REVOKE EXECUTE ON FUNCTION guard_wallet_ownership() FROM anon;
REVOKE EXECUTE ON FUNCTION payment_set_updated_at() FROM anon;
REVOKE EXECUTE ON FUNCTION wallet_set_updated_at() FROM anon;

-- Admin-only functions
REVOKE EXECUTE ON FUNCTION approve_refund(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION process_refund(uuid) FROM anon;

-- Also revoke from authenticated for trigger functions that should never be called directly
REVOKE EXECUTE ON FUNCTION calculate_platform_fee(numeric) FROM authenticated;
REVOKE EXECUTE ON FUNCTION ensure_single_active_fee() FROM authenticated;
REVOKE EXECUTE ON FUNCTION fee_set_updated_at() FROM authenticated;
REVOKE EXECUTE ON FUNCTION guard_ledger_immutable() FROM authenticated;
REVOKE EXECUTE ON FUNCTION guard_payment_ownership() FROM authenticated;
REVOKE EXECUTE ON FUNCTION guard_refund_ownership() FROM authenticated;
REVOKE EXECUTE ON FUNCTION guard_wallet_ownership() FROM authenticated;
REVOKE EXECUTE ON FUNCTION payment_set_updated_at() FROM authenticated;
REVOKE EXECUTE ON FUNCTION wallet_set_updated_at() FROM authenticated;

-- Admin-only functions should not be callable by authenticated users directly
-- (they verify is_admin() internally, but defense in depth)
-- Keep approve_refund and process_refund available to authenticated since they check is_admin() internally
