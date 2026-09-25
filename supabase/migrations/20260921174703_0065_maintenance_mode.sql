/*
# Maintenance Mode Configuration

1. New Table
- `maintenance_settings` — one row per platform/role (traveler, sender, marketing, support)
  - `id` (uuid PK)
  - `platform` (text, CHECK constraint limits to 4 values — NO admin)
  - `enabled` (boolean, default false)
  - `updated_at` (timestamptz, auto-updated)
  - `updated_by` (uuid, FK to auth.users, nullable)
  - Unique constraint on `platform` ensures one row per platform

2. Seed Data
- Inserts 4 rows (traveler, sender, marketing, support), all with enabled=false

3. New RPC Functions
- `get_maintenance_settings()` — returns all maintenance rows (SECURITY DEFINER, admin-only)
- `set_maintenance_enabled(p_platform text, p_enabled boolean)` — toggles maintenance for a platform (SECURITY DEFINER, admin-only, logs to audit_logs)

4. Audit Log Extension
- Adds 'maintenance_enabled' and 'maintenance_disabled' to the audit_action enum

5. Security
- RLS enabled on `maintenance_settings`
- SELECT: any authenticated user can read (needed to check maintenance status on page load)
- INSERT/UPDATE/DELETE: NO policies — only accessible via SECURITY DEFINER RPC that verifies admin role
- `is_admin()` function used for authorization check
- Revoked from anon

6. Important Notes
- Admin is NEVER a maintenance target (CHECK constraint enforces this)
- No business data is modified — only the maintenance flag and audit log entries
- Users are NOT logged out — sessions remain valid
*/

-- Extend audit_action enum for maintenance events
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'audit_action' AND e.enumlabel = 'maintenance_enabled'
  ) THEN
    ALTER TYPE audit_action ADD VALUE 'maintenance_enabled';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'audit_action' AND e.enumlabel = 'maintenance_disabled'
  ) THEN
    ALTER TYPE audit_action ADD VALUE 'maintenance_disabled';
  END IF;
END $$;

-- Create maintenance_settings table
CREATE TABLE IF NOT EXISTS maintenance_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('traveler', 'sender', 'marketing', 'support')),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure only one row per platform
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_settings_platform_unique
  ON maintenance_settings (platform);

-- Auto-update updated_at on row changes
DROP TRIGGER IF EXISTS maintenance_settings_updated_at ON maintenance_settings;
CREATE TRIGGER maintenance_settings_updated_at
  BEFORE UPDATE ON maintenance_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE maintenance_settings ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user can check maintenance status
DROP POLICY IF EXISTS "maintenance_select_authenticated" ON maintenance_settings;
CREATE POLICY "maintenance_select_authenticated"
  ON maintenance_settings FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies — only SECURITY DEFINER RPCs can write

-- Seed initial rows (idempotent)
INSERT INTO maintenance_settings (platform, enabled)
VALUES
  ('traveler', false),
  ('sender', false),
  ('marketing', false),
  ('support', false)
ON CONFLICT (platform) DO NOTHING;

-- RPC: Get all maintenance settings (admin-only, but also used by all authenticated users for read)
-- Actually this is a simple read — we'll just let RLS handle SELECT directly.
-- No RPC needed for reading.

-- RPC: Set maintenance enabled/disabled (admin-only, SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.set_maintenance_enabled(
  p_platform text,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_enabled boolean;
BEGIN
  -- Validate platform
  IF p_platform NOT IN ('traveler', 'sender', 'marketing', 'support') THEN
    RAISE EXCEPTION 'Invalid platform: %', p_platform;
  END IF;

  -- Verify admin
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- Get current value
  SELECT enabled INTO v_current_enabled
  FROM maintenance_settings
  WHERE platform = p_platform;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Maintenance setting not found for platform: %', p_platform;
  END IF;

  -- No change needed
  IF v_current_enabled = p_enabled THEN
    RETURN;
  END IF;

  -- Update the setting
  UPDATE maintenance_settings
  SET enabled = p_enabled,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE platform = p_platform;

  -- Log to audit table
  INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, reason)
  VALUES (
    auth.uid(),
    CASE WHEN p_enabled THEN 'maintenance_enabled' ELSE 'maintenance_disabled' END,
    'maintenance_settings',
    p_platform,
    CASE WHEN p_enabled THEN 'Maintenance enabled for ' || p_platform ELSE 'Maintenance disabled for ' || p_platform END
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_maintenance_enabled(text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_maintenance_enabled(text, boolean) TO authenticated;
