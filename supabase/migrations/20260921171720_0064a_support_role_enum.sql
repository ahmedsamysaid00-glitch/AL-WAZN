/*
# Support Messaging System — Step 1: Add support role enum value

1. Changes
- Adds 'support' to the existing user_role enum type.
- This must be in a separate migration because PostgreSQL requires
  new enum values to be committed before they can be referenced in queries.

2. Security
- No policy changes in this migration.
- The 'support' role value will be used in subsequent migrations for RLS.
*/

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'support';
