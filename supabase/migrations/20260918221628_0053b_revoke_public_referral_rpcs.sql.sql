/*
# Fix: Revoke PUBLIC execute on marketer referral RPCs

The initial REVOKE FROM anon was insufficient because the functions
were still callable via the PUBLIC role. This revokes from PUBLIC
and re-grants only to authenticated, matching the pattern used by
get_marketing_completed_orders (migration 0052).
*/

REVOKE EXECUTE ON FUNCTION get_marketer_referrals(text, text, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_marketer_referrals(text, text, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION get_marketer_referrals(text, text, int, int) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_marketer_referral_detail(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_marketer_referral_detail(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION get_marketer_referral_detail(uuid) TO authenticated;
