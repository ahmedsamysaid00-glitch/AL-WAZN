/*
# Phase 9 Step 1: Add new enum values for escrow lifecycle

This migration ONLY adds new enum values. PostgreSQL requires new enum
values to be committed before they can be used in constraints or function
bodies within the same transaction. So we split enum additions into a
separate migration.

## Enum changes:
- order_status: ADD 'awaiting_payment' (before 'confirmed')
- payment_status: ADD 'held' (before 'paid'), ADD 'released' (after 'paid')
- ledger_entry_type: ADD 'platform_held', ADD 'platform_release'
- notification_type: ADD 'payment_held', 'payment_released', 'order_awaiting_payment'
- audit_action: ADD 'payment_held', 'payment_released'
*/

-- order_status: add 'awaiting_payment'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'awaiting_payment' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'order_status')) THEN
    ALTER TYPE order_status ADD VALUE 'awaiting_payment' BEFORE 'confirmed';
  END IF;
END $$;

-- payment_status: add 'held' and 'released'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'held' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'payment_status')) THEN
    ALTER TYPE payment_status ADD VALUE 'held' BEFORE 'paid';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'released' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'payment_status')) THEN
    ALTER TYPE payment_status ADD VALUE 'released' AFTER 'paid';
  END IF;
END $$;

-- ledger_entry_type: add 'platform_held' and 'platform_release'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'platform_held' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ledger_entry_type')) THEN
    ALTER TYPE ledger_entry_type ADD VALUE 'platform_held' BEFORE 'refund';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'platform_release' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ledger_entry_type')) THEN
    ALTER TYPE ledger_entry_type ADD VALUE 'platform_release' BEFORE 'payout';
  END IF;
END $$;

-- notification_type: add 'payment_held', 'payment_released', 'order_awaiting_payment'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'payment_held' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notification_type')) THEN
    ALTER TYPE notification_type ADD VALUE 'payment_held';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'payment_released' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notification_type')) THEN
    ALTER TYPE notification_type ADD VALUE 'payment_released';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'order_awaiting_payment' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notification_type')) THEN
    ALTER TYPE notification_type ADD VALUE 'order_awaiting_payment';
  END IF;
END $$;

-- audit_action: add 'payment_held', 'payment_released'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'payment_held' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')) THEN
    ALTER TYPE audit_action ADD VALUE 'payment_held';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'payment_released' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')) THEN
    ALTER TYPE audit_action ADD VALUE 'payment_released';
  END IF;
END $$;
