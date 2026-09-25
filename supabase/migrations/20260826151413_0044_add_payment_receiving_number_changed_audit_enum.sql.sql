/*
# Add payment_receiving_number_changed to audit_action enum

## Summary
Adds the missing enum value `payment_receiving_number_changed` to the existing
`audit_action` PostgreSQL enum type.

## Why a separate migration
The `update_payment_receiving_number(p_number text)` RPC (migration 0043) uses
this enum value when inserting into `audit_logs`. PostgreSQL cannot safely
reference a newly-added enum value inside the same transaction that adds it.
This migration is therefore isolated to the enum change only.

## Changes
- `audit_action` enum gains one new value: `payment_receiving_number_changed`

## No other changes
- No table, policy, or function modifications.
- The existing RPC continues to work unchanged once this value exists.
*/

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_receiving_number_changed';
