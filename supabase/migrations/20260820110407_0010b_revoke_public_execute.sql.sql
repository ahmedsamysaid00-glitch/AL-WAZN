-- Fix: Revoke EXECUTE from PUBLIC on all trigger/helper functions
-- Supabase grants EXECUTE to anon/authenticated via PUBLIC role
-- We need to REVOKE FROM PUBLIC and then GRANT only to the specific roles that need it

-- Trigger functions: revoke from everyone (only triggers call them)
REVOKE EXECUTE ON FUNCTION order_set_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_order_ownership() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_order_status_transition() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_tracking_event_and_notify() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_tracking_event_immutable() FROM PUBLIC;

-- Order creation: revoke from PUBLIC and anon, grant only to authenticated
REVOKE EXECUTE ON FUNCTION create_order_from_collaboration(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_order_from_collaboration(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION create_order_from_collaboration(uuid) TO authenticated;
