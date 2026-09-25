/*
 * Phase 9 Step 3b: Drop old overloaded initiate_payment signatures
 *
 * The migration 0036 created a new initiate_payment with p_provider_session_id,
 * but CREATE OR REPLACE with a different signature creates an overload, not a
 * replacement. The old signatures (without provider_session_id) still exist
 * with their old logic and old grants. Drop them so only the new signature
 * remains, ensuring all calls go through the provider-aware version.
 */

-- Drop old overloaded signatures (keep only the 3-arg version with provider_session_id)
DROP FUNCTION IF EXISTS public.initiate_payment(uuid);
DROP FUNCTION IF EXISTS public.initiate_payment(uuid, payment_method_type);

-- Re-grant/revoke on the surviving signature to ensure correct privileges
REVOKE ALL ON FUNCTION public.initiate_payment(uuid, payment_method_type, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_payment(uuid, payment_method_type, text) TO authenticated;
