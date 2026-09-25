/*
# Marketing System — Enum Values Only

## Why a separate enum-only migration
PostgreSQL cannot safely reference a newly-added enum value inside the same
transaction that adds it. All enum values needed by later table/RPC migrations
are added here so the subsequent migrations can use them freely.

## Enums extended
1. user_role           — adds 'marketing'
2. audit_action        — adds marketing audit actions
3. notification_type   — adds marketing notification types
4. ledger_entry_type   — adds 'marketing_commission'

## New enums created
5. commission_status   — 'pending', 'approved', 'paid', 'reversed', 'cancelled'
6. referral_status     — 'attributed', 'registered', 'converted', 'expired'
7. commission_base     — 'platform_fee', 'order_total'
*/

-- 1. Add 'marketing' to user_role
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'marketing';

-- 2. Add marketing audit actions
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'marketer_assigned';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'marketing_settings_changed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'commission_created';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'commission_approved';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'commission_paid';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'commission_reversed';

-- 3. Add marketing notification types
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'commission_created';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'commission_approved';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'commission_paid';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'commission_reversed';

-- 4. Add marketing_commission to ledger_entry_type
ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'marketing_commission';

-- 5. Commission status enum
DO $$ BEGIN
  CREATE TYPE commission_status AS ENUM ('pending', 'approved', 'paid', 'reversed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6. Referral status enum
DO $$ BEGIN
  CREATE TYPE referral_status AS ENUM ('attributed', 'registered', 'converted', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 7. Commission base enum
DO $$ BEGIN
  CREATE TYPE commission_base AS ENUM ('platform_fee', 'order_total');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
