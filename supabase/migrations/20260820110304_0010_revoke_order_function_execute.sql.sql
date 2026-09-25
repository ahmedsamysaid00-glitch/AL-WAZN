-- Phase 6 Security Advisor Fix: Revoke EXECUTE on trigger/helper functions from anon and authenticated
-- These functions are only meant to be called by database triggers, not via REST API.

-- Trigger functions: revoke from anon AND authenticated (only triggers should call these)
REVOKE EXECUTE ON FUNCTION order_set_updated_at() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION guard_order_ownership() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION guard_order_status_transition() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION create_tracking_event_and_notify() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION guard_tracking_event_immutable() FROM anon, authenticated;

-- Order creation function: revoke from anon only (authenticated needs it to create orders)
REVOKE EXECUTE ON FUNCTION create_order_from_collaboration(uuid) FROM anon;
