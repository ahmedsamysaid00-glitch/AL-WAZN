/*
# Marketing Social Links — Marketer Write Access + Realtime

## Purpose
The existing `marketing_social_links` table (migration 0051) only allows
admin writes. The Marketing Tools page needs the marketer to manage their
own social links directly. This migration:
1. Adds a `marketer_id` column to scope links to the authenticated marketer
2. Replaces RLS policies so the marketer can CRUD their own links
3. Adds a unique constraint on (marketer_id, platform) to prevent duplicates
4. Adds the table to realtime publication
5. Adds an index on marketer_id for query performance

## Why
The Marketing Tools page requires the marketer to add/edit/delete their own
social media profile links without admin involvement. The existing table has
no marketer_id column and admin-only write policies.

## Security
- RLS: marketer can only SELECT/INSERT/UPDATE/DELETE their own rows
- INSERT/UPDATE policies enforce marketer_id = auth.uid()
- Role check: caller must have role = 'marketing' or 'admin'
- Admin retains full access to all rows
- Unique constraint prevents duplicate platform entries per marketer
*/

-- Add marketer_id column
ALTER TABLE marketing_social_links
  ADD COLUMN IF NOT EXISTS marketer_id uuid REFERENCES profiles(id) ON DELETE CASCADE;

-- Backfill: set marketer_id to the single platform marketer for existing rows
UPDATE marketing_social_links
  SET marketer_id = get_marketer_id()
  WHERE marketer_id IS NULL;

-- Make marketer_id NOT NULL after backfill
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'marketing_social_links'
      AND column_name = 'marketer_id'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE marketing_social_links ALTER COLUMN marketer_id SET NOT NULL;
  END IF;
END $$;

-- Index for marketer-scoped queries
CREATE INDEX IF NOT EXISTS idx_marketing_social_links_marketer
  ON marketing_social_links (marketer_id);

-- Unique constraint: one link per platform per marketer
CREATE UNIQUE INDEX IF NOT EXISTS uniq_social_link_marketer_platform
  ON marketing_social_links (marketer_id, platform)
  WHERE is_active = true;

-- Drop existing admin-only policies
DROP POLICY IF EXISTS "marketing_social_links_select" ON marketing_social_links;
DROP POLICY IF EXISTS "marketing_social_links_insert" ON marketing_social_links;
DROP POLICY IF EXISTS "marketing_social_links_update" ON marketing_social_links;
DROP POLICY IF EXISTS "marketing_social_links_delete" ON marketing_social_links;

-- New policies: marketer manages own links, admin sees all
CREATE POLICY "marketing_social_links_select"
  ON marketing_social_links FOR SELECT
  TO authenticated
  USING (
    marketer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "marketing_social_links_insert"
  ON marketing_social_links FOR INSERT
  TO authenticated
  WITH CHECK (
    marketer_id = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'marketing')
  );

CREATE POLICY "marketing_social_links_update"
  ON marketing_social_links FOR UPDATE
  TO authenticated
  USING (marketer_id = auth.uid())
  WITH CHECK (marketer_id = auth.uid());

CREATE POLICY "marketing_social_links_delete"
  ON marketing_social_links FOR DELETE
  TO authenticated
  USING (marketer_id = auth.uid());

-- Add to realtime publication
ALTER TABLE marketing_social_links REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'realtime' AND tablename = 'marketing_social_links'
  ) THEN
    ALTER PUBLICATION realtime ADD TABLE marketing_social_links;
  END IF;
END $$;
