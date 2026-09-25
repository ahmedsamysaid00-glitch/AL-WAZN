/*
# Phase 7b — Revoke PUBLIC Execute on SECURITY DEFINER Functions

## Purpose
Migration 0070 revoked EXECUTE from `anon` on 7 SECURITY DEFINER functions,
but the grants were to `PUBLIC` (not `anon` specifically), so `=X/postgres`
still appears in proacl. This migration revokes EXECUTE from `PUBLIC` on
those 7 functions, closing the anon access path.

## Functions affected
- public.get_marketing_completed_orders
- public.get_or_create_support_conversation
- public.get_support_stats
- public.is_support
- public.set_maintenance_enabled(text, boolean)
- public.trg_fn_commission_on_payment_hold
- public.trg_fn_reverse_commission_on_refund

## Security
- No RLS changes
- No data loss
- No functional changes for authenticated users (they retain EXECUTE)
- Only removes the ability for unauthenticated/anon callers to invoke
*/

REVOKE EXECUTE ON FUNCTION get_marketing_completed_orders() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_or_create_support_conversation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_support_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_support() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION set_maintenance_enabled(text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_fn_commission_on_payment_hold() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_fn_reverse_commission_on_refund() FROM PUBLIC;