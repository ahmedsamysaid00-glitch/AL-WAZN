/*
# Platform Payment Settings Table

## Summary
Creates a dedicated `platform_settings` table to store database-backed platform
configuration. The first setting is `payment_receiving_number` — the number
senders transfer money to for manual payments. This replaces the hardcoded
constant in `platformConfig.ts` so admins can change it without a code deploy.

## New Tables
- `platform_settings`
  - `id` (uuid PK, single-row by convention)
  - `payment_receiving_number` (text, NOT NULL) — the official receiving number
  - `updated_at` (timestamptz) — last modification time
  - `updated_by` (uuid, FK -> auth.users) — admin who last changed it

## Security
- RLS enabled: all authenticated users can SELECT (senders need to read the number)
- Only admins can INSERT/UPDATE/DELETE (enforced via RLS + RPC)
- No direct INSERT/UPDATE/DELETE by normal or anonymous users

## Seed
- Inserts a single row with `payment_receiving_number = '01025716442'`

## Realtime
- Adds `platform_settings` to the realtime publication so open payment screens
  update automatically when an admin changes the number.
*/

CREATE TABLE IF NOT EXISTS platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_receiving_number text NOT NULL DEFAULT '01025716442',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- All authenticated users (senders) can read the receiving number
DROP POLICY IF EXISTS "settings_select_all" ON platform_settings;
CREATE POLICY "settings_select_all" ON platform_settings FOR SELECT
  TO authenticated USING (true);

-- Only admins can insert
DROP POLICY IF EXISTS "settings_insert_admin" ON platform_settings;
CREATE POLICY "settings_insert_admin" ON platform_settings FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Only admins can update
DROP POLICY IF EXISTS "settings_update_admin" ON platform_settings;
CREATE POLICY "settings_update_admin" ON platform_settings FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Only admins can delete
DROP POLICY IF EXISTS "settings_delete_admin" ON platform_settings;
CREATE POLICY "settings_delete_admin" ON platform_settings FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Seed the single settings row if it doesn't exist
INSERT INTO platform_settings (payment_receiving_number)
SELECT '01025716442'
WHERE NOT EXISTS (SELECT 1 FROM platform_settings);

-- Add to realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'realtime' AND schemaname = 'public' AND tablename = 'platform_settings'
  ) THEN
    EXECUTE 'ALTER PUBLICATION realtime ADD TABLE public.platform_settings';
  END IF;
END $$;

ALTER TABLE public.platform_settings REPLICA IDENTITY FULL;
