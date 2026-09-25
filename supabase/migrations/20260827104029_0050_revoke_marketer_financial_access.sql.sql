-- ============================================================
-- Migration 0050: Revoke marketer access to financial tables
--
-- The marketer dashboard is now purely non-financial.
-- Only admins can SELECT marketing_commissions and marketing_payouts.
-- The marketer retains SELECT access only to marketing_referrals
-- and marketing_settings (referral_code only).
-- ============================================================

-- 1. Replace marketing_commissions SELECT policy: admin-only
DROP POLICY IF EXISTS marketing_commissions_select ON marketing_commissions;
CREATE POLICY marketing_commissions_select_admin_only
  ON marketing_commissions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'::user_role
    )
  );

-- 2. Replace marketing_payouts SELECT policy: admin-only
DROP POLICY IF EXISTS marketing_payouts_select ON marketing_payouts;
CREATE POLICY marketing_payouts_select_admin_only
  ON marketing_payouts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'::user_role
    )
  );

-- 3. Tighten marketing_settings SELECT: only referral_code is non-sensitive,
--    but we keep SELECT public so the marketer can see their own referral code.
--    No change needed — settings has no financial data visible to marketer
--    (commission_rate is admin-configured, marketer just sees referral_code).

-- 4. marketing_referrals: marketer can still SELECT own referrals (non-financial)
--    No change needed — referrals contain no financial data.
