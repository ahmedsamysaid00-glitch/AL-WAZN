/*
# Marketing System — Add marketing tables to realtime publication

The marketing dashboard uses realtime to update when:
- a referral is registered
- a commission is created/approved/paid/reversed
- a payout is created
*/

-- Add marketing tables to the realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE marketing_referrals;
ALTER PUBLICATION supabase_realtime ADD TABLE marketing_commissions;
ALTER PUBLICATION supabase_realtime ADD TABLE marketing_payouts;
ALTER PUBLICATION supabase_realtime ADD TABLE marketing_settings;
