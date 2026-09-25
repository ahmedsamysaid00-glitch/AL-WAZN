/*
# Marketing Social Media Links Table

1. Purpose
   - Stores the marketer's social media profile links and follower counts.
   - Only the marketing role user and admins can access this data.
   - Used by the marketer dashboard's "Social Media" section.

2. New Tables
   - `marketing_social_links`
     - `id` (uuid, primary key)
     - `platform` (text, not null) — e.g. 'tiktok', 'instagram', 'facebook', 'x'
     - `profile_url` (text, not null) — full URL to the social profile
     - `display_name` (text, null) — optional display name for the profile
     - `follower_count` (integer, null) — optional follower count (manually entered)
     - `is_active` (boolean, default true)
     - `created_at` (timestamptz, default now)
     - `updated_at` (timestamptz, default now)

3. Security
   - Enable RLS on `marketing_social_links`.
   - SELECT: admin and marketing roles can read.
   - INSERT/UPDATE/DELETE: admin role only (marketer cannot modify social links).
   - Uses `auth.uid()` with a subquery to `profiles` for role checks.
*/
CREATE TABLE IF NOT EXISTS marketing_social_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  profile_url text NOT NULL,
  display_name text,
  follower_count integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE marketing_social_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketing_social_links_select" ON marketing_social_links;
CREATE POLICY "marketing_social_links_select"
  ON marketing_social_links FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin'::user_role, 'marketing'::user_role)
    )
  );

DROP POLICY IF EXISTS "marketing_social_links_insert" ON marketing_social_links;
CREATE POLICY "marketing_social_links_insert"
  ON marketing_social_links FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'::user_role
    )
  );

DROP POLICY IF EXISTS "marketing_social_links_update" ON marketing_social_links;
CREATE POLICY "marketing_social_links_update"
  ON marketing_social_links FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'::user_role
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'::user_role
    )
  );

DROP POLICY IF EXISTS "marketing_social_links_delete" ON marketing_social_links;
CREATE POLICY "marketing_social_links_delete"
  ON marketing_social_links FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'::user_role
    )
  );