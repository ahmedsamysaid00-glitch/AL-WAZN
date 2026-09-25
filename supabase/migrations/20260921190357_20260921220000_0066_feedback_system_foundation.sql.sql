/*
# "Your Voice Improves El Wazn" — Phase 1: Feedback System Foundation

## Purpose
Creates the database backend for a platform feedback system where Travelers and
Senders can submit general feedback, suggestions, bug reports, and security
reports. Admins can review, manage status, and add internal notes. The system
is designed for a future public ideas page with community voting.

## 1. New Enums
- `feedback_type`: general_feedback | suggestion | bug_report | security_report
- `feedback_category`: 23 categories across suggestion/bug/security/general types
- `feedback_status`: new | under_review | in_progress | resolved | closed | rejected | archived
- `feedback_user_type`: traveler | sender

## 2. New Tables
### feedback
- id (uuid PK)
- user_id → profiles.id (ON DELETE CASCADE)
- user_type (feedback_user_type) — traveler or sender at time of submission
- type (feedback_type) — general/suggestion/bug/security
- category (feedback_category)
- title (text, 1-200 chars)
- message (text, 1-5000 chars)
- rating (smallint, 1-5, nullable)
- status (feedback_status, default 'new')
- is_public (boolean, default false)
- is_sensitive (boolean, default true for security_report, false otherwise)
- source (text, nullable) — 'app' | 'website' | other
- page_url (text, nullable)
- device_type (text, nullable)
- operating_system (text, nullable)
- browser (text, nullable)
- context_type (text, nullable) — 'trip' | 'listing' | 'order' | 'conversation'
- context_id (uuid, nullable) — FK to the relevant table
- expected_behavior (text, nullable)
- proposed_solution (text, nullable)
- archived_at (timestamptz, nullable)
- archived_by → profiles.id (nullable, ON DELETE SET NULL)
- created_at, updated_at (timestamptz)

### feedback_votes
- id (uuid PK)
- feedback_id → feedback.id (ON DELETE CASCADE)
- user_id → profiles.id (ON DELETE CASCADE)
- created_at (timestamptz)
- UNIQUE (feedback_id, user_id) — one vote per user per feedback

### feedback_attachments
- id (uuid PK)
- feedback_id → feedback.id (ON DELETE CASCADE)
- storage_path (text) — path in the feedback-attachments storage bucket
- file_type (text, nullable)
- created_at (timestamptz)

### feedback_status_history
- id (uuid PK)
- feedback_id → feedback.id (ON DELETE CASCADE)
- old_status (feedback_status, nullable)
- new_status (feedback_status)
- changed_by → profiles.id (ON DELETE SET NULL)
- note (text, nullable)
- created_at (timestamptz)

### feedback_internal_notes
- id (uuid PK)
- feedback_id → feedback.id (ON DELETE CASCADE)
- admin_id → profiles.id (ON DELETE SET NULL)
- note (text, 1-5000 chars)
- created_at, updated_at (timestamptz)

## 3. Storage
- Private bucket `feedback-attachments` (10MB, images + PDF)
- Per-user folder: path must start with auth.uid()

## 4. RLS Summary
### feedback
- SELECT: own feedback OR is_admin(). Public suggestions visible to all authenticated.
  Security reports visible to owner + admin only (even if is_public).
- INSERT: traveler/sender only, user_id = auth.uid(), security reports forced private.
- UPDATE: admin only (via RPC). Users cannot change status, is_public, or sensitive fields.
- DELETE: admin only (via RPC).

### feedback_votes
- SELECT: all authenticated can see vote counts on public suggestions.
- INSERT: traveler/sender only, one per user, not on own feedback, not on security reports.
- DELETE: admin only.

### feedback_attachments
- SELECT: owner of parent feedback OR is_admin().
- INSERT: owner of parent feedback only.
- DELETE: admin only.

### feedback_status_history
- SELECT: owner of parent feedback OR is_admin().
- INSERT: admin only (via SECURITY DEFINER RPC). Users cannot forge history.
- DELETE: admin only.

### feedback_internal_notes
- SELECT: is_admin() only. Never visible to travelers/senders.
- INSERT/UPDATE: is_admin() only.
- DELETE: is_admin() only.

## 5. RPCs
- `set_feedback_status(p_feedback_id, p_new_status, p_note)` — SECURITY DEFINER, admin-only.
  Changes status, creates history record, logs to audit_logs, sends notification.
- `set_feedback_public(p_feedback_id, p_is_public)` — SECURITY DEFINER, admin-only.
  Cannot make security reports public.
- `archive_feedback(p_feedback_id, p_archived)` — SECURITY DEFINER, admin-only.
- `add_feedback_internal_note(p_feedback_id, p_note)` — SECURITY DEFINER, admin-only.
- `create_feedback(p_type, p_category, p_title, p_message, p_rating, p_is_public, ...)` —
  SECURITY DEFINER, traveler/sender only. Enforces rate limiting (1 per 2 minutes),
  validates user_type from profile, forces security reports private.
- `vote_feedback(p_feedback_id)` — SECURITY DEFINER, traveler/sender only.
  Prevents voting on own feedback, security reports, non-public suggestions.
  Enforces one vote per user via unique constraint.

## 6. Spam Protection
- Rate limit: 1 feedback per user per 2 minutes (enforced in create_feedback RPC).
- One vote per user per feedback (UNIQUE constraint + RPC check).
- Cannot vote on own feedback.
- Cannot vote on security reports or non-public suggestions.

## 7. Security Report Privacy
- Security reports are ALWAYS private (is_public = false enforced at DB level).
- Security report content is only visible to owner + admin.
- Security report attachments are only visible to owner + admin.
- is_public cannot be enabled for security reports (DB constraint + RPC guard).

## 8. Notification Integration
- Uses existing `notification_type` enum (adds 'feedback_status_changed' value).
- `set_feedback_status` RPC inserts into existing `notifications` table.
- No new notification table or system.

## 9. Audit Log Integration
- `set_feedback_status` logs to `audit_logs` with action 'feedback_status_changed'.
- `set_feedback_public` logs with action 'feedback_visibility_changed'.
- `archive_feedback` logs with action 'feedback_archived'.
- Requires adding these values to the `audit_action` enum.

## 10. Indexes
- feedback: user_id, type, category, status, rating, is_public, created_at, updated_at, user_type
- feedback_votes: unique(feedback_id, user_id), feedback_id, user_id
- feedback_attachments: feedback_id
- feedback_status_history: feedback_id, created_at
- feedback_internal_notes: feedback_id, created_at

## 11. Important Notes
1. No existing tables are modified destructively.
2. No existing business logic is changed.
3. All migrations are additive.
4. Admin authorization uses existing is_admin() helper.
5. Storage follows existing private bucket pattern (per-user folder via auth.uid()).
6. Notifications use existing notifications table and notification_type enum.
7. Audit logs use existing audit_logs table and audit_action enum.
*/

-- ============================================================
-- 1. ENUMS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE feedback_type AS ENUM (
    'general_feedback',
    'suggestion',
    'bug_report',
    'security_report'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE feedback_status AS ENUM (
    'new',
    'under_review',
    'in_progress',
    'resolved',
    'closed',
    'rejected',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE feedback_user_type AS ENUM (
    'traveler',
    'sender'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE feedback_category AS ENUM (
    -- Suggestion categories
    'new_feature',
    'improve_existing_feature',
    'design',
    'traveler_experience',
    'sender_experience',
    'communication',
    'safety_trust',
    'identity_verification',
    'tracking',
    'payments',
    'notifications',
    'other',
    -- Bug report categories
    'registration',
    'login',
    'account',
    'create_listing',
    'search',
    'orders',
    'messages',
    'file_upload',
    'technical_other',
    -- Security report categories
    'suspicious_account',
    'suspicious_listing',
    'inappropriate_behavior',
    'off_platform_contact',
    'privacy_issue',
    'security_other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend audit_action enum for feedback operations
DO $$ BEGIN
  ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'feedback_status_changed';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'feedback_visibility_changed';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'feedback_archived';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend notification_type enum for feedback notifications
DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'feedback_status_changed';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. FEEDBACK TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_type feedback_user_type NOT NULL,
  type feedback_type NOT NULL,
  category feedback_category NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  rating smallint,
  status feedback_status NOT NULL DEFAULT 'new',
  is_public boolean NOT NULL DEFAULT false,
  is_sensitive boolean NOT NULL DEFAULT false,
  source text,
  page_url text,
  device_type text,
  operating_system text,
  browser text,
  context_type text,
  context_id uuid,
  expected_behavior text,
  proposed_solution text,
  archived_at timestamptz,
  archived_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fb_title_not_empty CHECK (btrim(title) <> ''),
  CONSTRAINT fb_title_max_length CHECK (length(title) <= 200),
  CONSTRAINT fb_message_not_empty CHECK (btrim(message) <> ''),
  CONSTRAINT fb_message_max_length CHECK (length(message) <= 5000),
  CONSTRAINT fb_rating_range CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  CONSTRAINT fb_security_never_public CHECK (
    (type <> 'security_report') OR (is_public = false)
  ),
  CONSTRAINT fb_security_is_sensitive CHECK (
    (type <> 'security_report') OR (is_sensitive = true)
  )
);

CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback (type);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback (category);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback (status);
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback (rating);
CREATE INDEX IF NOT EXISTS idx_feedback_is_public ON feedback (is_public);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_updated_at ON feedback (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user_type ON feedback (user_type);
CREATE INDEX IF NOT EXISTS idx_feedback_public_suggestions ON feedback (id) WHERE is_public = true AND type = 'suggestion' AND status NOT IN ('archived', 'rejected');

-- ============================================================
-- 3. FEEDBACK_VOTES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id uuid NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_one_vote_per_user_per_feedback UNIQUE (feedback_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_votes_feedback_id ON feedback_votes (feedback_id);
CREATE INDEX IF NOT EXISTS idx_feedback_votes_user_id ON feedback_votes (user_id);

-- ============================================================
-- 4. FEEDBACK_ATTACHMENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id uuid NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_attachments_feedback_id ON feedback_attachments (feedback_id);

-- ============================================================
-- 5. FEEDBACK_STATUS_HISTORY TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id uuid NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  old_status feedback_status,
  new_status feedback_status NOT NULL,
  changed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_history_feedback_id ON feedback_status_history (feedback_id);
CREATE INDEX IF NOT EXISTS idx_feedback_history_created_at ON feedback_status_history (created_at DESC);

-- ============================================================
-- 6. FEEDBACK_INTERNAL_NOTES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback_internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id uuid NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fb_note_not_empty CHECK (btrim(note) <> ''),
  CONSTRAINT fb_note_max_length CHECK (length(note) <= 5000)
);

CREATE INDEX IF NOT EXISTS idx_feedback_notes_feedback_id ON feedback_internal_notes (feedback_id);
CREATE INDEX IF NOT EXISTS idx_feedback_notes_created_at ON feedback_internal_notes (created_at DESC);

-- ============================================================
-- 7. UPDATED_AT TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION feedback_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feedback_updated_at ON feedback;
CREATE TRIGGER feedback_updated_at
  BEFORE UPDATE ON feedback
  FOR EACH ROW EXECUTE FUNCTION feedback_set_updated_at();

CREATE OR REPLACE FUNCTION feedback_notes_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feedback_notes_updated_at ON feedback_internal_notes;
CREATE TRIGGER feedback_notes_updated_at
  BEFORE UPDATE ON feedback_internal_notes
  FOR EACH ROW EXECUTE FUNCTION feedback_notes_set_updated_at();

-- ============================================================
-- 8. STORAGE BUCKET
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback-attachments',
  'feedback-attachments',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies: per-user folder (auth.uid()/filename)
DROP POLICY IF EXISTS "feedback_attachments_upload_own" ON storage.objects;
CREATE POLICY "feedback_attachments_upload_own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'feedback-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "feedback_attachments_read_own" ON storage.objects;
CREATE POLICY "feedback_attachments_read_own"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'feedback-attachments'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_admin()
  )
);

DROP POLICY IF EXISTS "feedback_attachments_delete_admin" ON storage.objects;
CREATE POLICY "feedback_attachments_delete_admin"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'feedback-attachments'
  AND public.is_admin()
);

-- ============================================================
-- 9. RLS — FEEDBACK
-- ============================================================

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- SELECT: own feedback, admin sees all, public suggestions visible to authenticated
DROP POLICY IF EXISTS "feedback_select" ON feedback;
CREATE POLICY "feedback_select"
ON feedback FOR SELECT
TO authenticated
USING (
  -- Owner can see their own feedback
  auth.uid() = user_id
  -- Admin can see everything
  OR public.is_admin()
  -- Public suggestions (not security reports) visible to all authenticated
  OR (
    is_public = true
    AND type = 'suggestion'
    AND status NOT IN ('archived', 'rejected')
  )
);

-- INSERT: traveler/sender only, must own the feedback
DROP POLICY IF EXISTS "feedback_insert" ON feedback;
CREATE POLICY "feedback_insert"
ON feedback FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND type <> 'security_report' OR is_public = false
);

-- UPDATE: admin only — users cannot modify feedback after submission
DROP POLICY IF EXISTS "feedback_update" ON feedback;
CREATE POLICY "feedback_update"
ON feedback FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- DELETE: admin only
DROP POLICY IF EXISTS "feedback_delete" ON feedback;
CREATE POLICY "feedback_delete"
ON feedback FOR DELETE
TO authenticated
USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON feedback TO authenticated;

-- ============================================================
-- 10. RLS — FEEDBACK_VOTES
-- ============================================================

ALTER TABLE feedback_votes ENABLE ROW LEVEL SECURITY;

-- SELECT: all authenticated can see votes on public suggestions
DROP POLICY IF EXISTS "feedback_votes_select" ON feedback_votes;
CREATE POLICY "feedback_votes_select"
ON feedback_votes FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM feedback f
    WHERE f.id = feedback_votes.feedback_id
    AND (
      f.is_public = true
      AND f.type = 'suggestion'
      AND f.status NOT IN ('archived', 'rejected')
    )
  )
  OR public.is_admin()
);

-- INSERT: traveler/sender only, one vote per user (UNIQUE constraint enforces)
DROP POLICY IF EXISTS "feedback_votes_insert" ON feedback_votes;
CREATE POLICY "feedback_votes_insert"
ON feedback_votes FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM feedback f
    WHERE f.id = feedback_votes.feedback_id
    AND f.is_public = true
    AND f.type = 'suggestion'
    AND f.status NOT IN ('archived', 'rejected')
    AND f.user_id <> auth.uid()
  )
);

-- DELETE: admin only
DROP POLICY IF EXISTS "feedback_votes_delete" ON feedback_votes;
CREATE POLICY "feedback_votes_delete"
ON feedback_votes FOR DELETE
TO authenticated
USING (public.is_admin());

GRANT SELECT, INSERT, DELETE ON feedback_votes TO authenticated;

-- ============================================================
-- 11. RLS — FEEDBACK_ATTACHMENTS
-- ============================================================

ALTER TABLE feedback_attachments ENABLE ROW LEVEL SECURITY;

-- SELECT: owner of parent feedback or admin
DROP POLICY IF EXISTS "feedback_attachments_select" ON feedback_attachments;
CREATE POLICY "feedback_attachments_select"
ON feedback_attachments FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM feedback f
    WHERE f.id = feedback_attachments.feedback_id
    AND (
      f.user_id = auth.uid()
      OR public.is_admin()
    )
  )
);

-- INSERT: owner of parent feedback only
DROP POLICY IF EXISTS "feedback_attachments_insert" ON feedback_attachments;
CREATE POLICY "feedback_attachments_insert"
ON feedback_attachments FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM feedback f
    WHERE f.id = feedback_attachments.feedback_id
    AND f.user_id = auth.uid()
  )
);

-- DELETE: admin only
DROP POLICY IF EXISTS "feedback_attachments_delete" ON feedback_attachments;
CREATE POLICY "feedback_attachments_delete"
ON feedback_attachments FOR DELETE
TO authenticated
USING (public.is_admin());

GRANT SELECT, INSERT, DELETE ON feedback_attachments TO authenticated;

-- ============================================================
-- 12. RLS — FEEDBACK_STATUS_HISTORY
-- ============================================================

ALTER TABLE feedback_status_history ENABLE ROW LEVEL SECURITY;

-- SELECT: owner of parent feedback or admin
DROP POLICY IF EXISTS "feedback_history_select" ON feedback_status_history;
CREATE POLICY "feedback_history_select"
ON feedback_status_history FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM feedback f
    WHERE f.id = feedback_status_history.feedback_id
    AND (
      f.user_id = auth.uid()
      OR public.is_admin()
    )
  )
);

-- INSERT: admin only (via SECURITY DEFINER RPC)
DROP POLICY IF EXISTS "feedback_history_insert" ON feedback_status_history;
CREATE POLICY "feedback_history_insert"
ON feedback_status_history FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- DELETE: admin only
DROP POLICY IF EXISTS "feedback_history_delete" ON feedback_status_history;
CREATE POLICY "feedback_history_delete"
ON feedback_status_history FOR DELETE
TO authenticated
USING (public.is_admin());

GRANT SELECT, INSERT, DELETE ON feedback_status_history TO authenticated;

-- ============================================================
-- 13. RLS — FEEDBACK_INTERNAL_NOTES
-- ============================================================

ALTER TABLE feedback_internal_notes ENABLE ROW LEVEL SECURITY;

-- SELECT: admin only — never visible to travelers/senders
DROP POLICY IF EXISTS "feedback_notes_select" ON feedback_internal_notes;
CREATE POLICY "feedback_notes_select"
ON feedback_internal_notes FOR SELECT
TO authenticated
USING (public.is_admin());

-- INSERT: admin only
DROP POLICY IF EXISTS "feedback_notes_insert" ON feedback_internal_notes;
CREATE POLICY "feedback_notes_insert"
ON feedback_internal_notes FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- UPDATE: admin only
DROP POLICY IF EXISTS "feedback_notes_update" ON feedback_internal_notes;
CREATE POLICY "feedback_notes_update"
ON feedback_internal_notes FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- DELETE: admin only
DROP POLICY IF EXISTS "feedback_notes_delete" ON feedback_internal_notes;
CREATE POLICY "feedback_notes_delete"
ON feedback_internal_notes FOR DELETE
TO authenticated
USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON feedback_internal_notes TO authenticated;

-- ============================================================
-- 14. SECURITY DEFINER RPCs
-- ============================================================

-- create_feedback: traveler/sender only, with rate limiting
CREATE OR REPLACE FUNCTION create_feedback(
  p_type feedback_type,
  p_category feedback_category,
  p_title text,
  p_message text,
  p_rating smallint DEFAULT NULL,
  p_is_public boolean DEFAULT false,
  p_source text DEFAULT NULL,
  p_page_url text DEFAULT NULL,
  p_device_type text DEFAULT NULL,
  p_operating_system text DEFAULT NULL,
  p_browser text DEFAULT NULL,
  p_context_type text DEFAULT NULL,
  p_context_id uuid DEFAULT NULL,
  p_expected_behavior text DEFAULT NULL,
  p_proposed_solution text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_user_type feedback_user_type;
  v_is_public boolean := p_is_public;
  v_is_sensitive boolean := false;
  v_recent_count int;
  v_new_id uuid;
BEGIN
  -- Must be authenticated
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Get user role from profiles
  SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = '42704';
  END IF;

  -- Only traveler and sender can submit feedback
  IF v_role NOT IN ('traveler', 'sender') THEN
    RAISE EXCEPTION 'Only travelers and senders can submit feedback' USING ERRCODE = '42501';
  END IF;

  -- Map role to user_type
  v_user_type := v_role::feedback_user_type;

  -- Security reports are always private and sensitive
  IF p_type = 'security_report' THEN
    v_is_public := false;
    v_is_sensitive := true;
  END IF;

  -- Rate limit: 1 feedback per 2 minutes
  SELECT count(*) INTO v_recent_count
  FROM feedback
  WHERE user_id = v_user_id
    AND created_at > now() - interval '2 minutes';

  IF v_recent_count > 0 THEN
    RAISE EXCEPTION 'Please wait before submitting another feedback' USING ERRCODE = '42901';
  END IF;

  -- Validate inputs
  IF btrim(p_title) = '' OR length(p_title) > 200 THEN
    RAISE EXCEPTION 'Invalid title' USING ERRCODE = '23514';
  END IF;
  IF btrim(p_message) = '' OR length(p_message) > 5000 THEN
    RAISE EXCEPTION 'Invalid message' USING ERRCODE = '23514';
  END IF;
  IF p_rating IS NOT NULL AND (p_rating < 1 OR p_rating > 5) THEN
    RAISE EXCEPTION 'Invalid rating' USING ERRCODE = '23514';
  END IF;

  -- Insert feedback
  INSERT INTO feedback (
    user_id, user_type, type, category, title, message, rating,
    status, is_public, is_sensitive, source, page_url, device_type,
    operating_system, browser, context_type, context_id,
    expected_behavior, proposed_solution
  )
  VALUES (
    v_user_id, v_user_type, p_type, p_category, p_title, p_message, p_rating,
    'new', v_is_public, v_is_sensitive, p_source, p_page_url, p_device_type,
    p_operating_system, p_browser, p_context_type, p_context_id,
    p_expected_behavior, p_proposed_solution
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_feedback FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_feedback TO authenticated;

-- vote_feedback: traveler/sender only, one vote per user, not on own/security reports
CREATE OR REPLACE FUNCTION vote_feedback(p_feedback_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_fb record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  IF v_role NOT IN ('traveler', 'sender') THEN
    RAISE EXCEPTION 'Only travelers and senders can vote' USING ERRCODE = '42501';
  END IF;

  SELECT type, is_public, user_id, status INTO v_fb
  FROM feedback WHERE id = p_feedback_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Feedback not found' USING ERRCODE = '42704';
  END IF;

  -- Must be a public suggestion
  IF v_fb.type <> 'suggestion' OR v_fb.is_public = false THEN
    RAISE EXCEPTION 'Can only vote on public suggestions' USING ERRCODE = '42501';
  END IF;

  -- Must not be archived or rejected
  IF v_fb.status IN ('archived', 'rejected') THEN
    RAISE EXCEPTION 'Cannot vote on archived or rejected suggestions' USING ERRCODE = '42501';
  END IF;

  -- Cannot vote on own feedback
  IF v_fb.user_id = v_user_id THEN
    RAISE EXCEPTION 'Cannot vote on your own feedback' USING ERRCODE = '42501';
  END IF;

  -- Insert vote (UNIQUE constraint enforces one per user)
  INSERT INTO feedback_votes (feedback_id, user_id)
  VALUES (p_feedback_id, v_user_id)
  ON CONFLICT (feedback_id, user_id) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION vote_feedback FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION vote_feedback TO authenticated;

-- set_feedback_status: admin only, creates history + notification + audit log
CREATE OR REPLACE FUNCTION set_feedback_status(
  p_feedback_id uuid,
  p_new_status feedback_status,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_old_status feedback_status;
  v_user_id uuid;
  v_type feedback_type;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT status, user_id, type INTO v_old_status, v_user_id, v_type
  FROM feedback WHERE id = p_feedback_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Feedback not found' USING ERRCODE = '42704';
  END IF;

  -- Update feedback status
  UPDATE feedback SET status = p_new_status WHERE id = p_feedback_id;

  -- Create status history record
  INSERT INTO feedback_status_history (feedback_id, old_status, new_status, changed_by, note)
  VALUES (p_feedback_id, v_old_status, p_new_status, v_admin_id, p_note);

  -- Log to audit_logs
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_admin_id, v_user_id, 'feedback_status_changed', 'feedback', p_feedback_id::text::uuid, p_note);

  -- Send notification to feedback owner (only for meaningful status changes)
  IF v_old_status <> p_new_status THEN
    INSERT INTO notifications (user_id, type, title, body)
    VALUES (
      v_user_id,
      'feedback_status_changed',
      'Feedback status updated',
      'Your feedback status has been updated to: ' || p_new_status::text
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_feedback_status FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_feedback_status TO authenticated;

-- set_feedback_public: admin only, cannot make security reports public
CREATE OR REPLACE FUNCTION set_feedback_public(
  p_feedback_id uuid,
  p_is_public boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_type feedback_type;
  v_user_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT type, user_id INTO v_type, v_user_id
  FROM feedback WHERE id = p_feedback_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Feedback not found' USING ERRCODE = '42704';
  END IF;

  -- Security reports can never be public
  IF v_type = 'security_report' AND p_is_public = true THEN
    RAISE EXCEPTION 'Security reports cannot be made public' USING ERRCODE = '42501';
  END IF;

  UPDATE feedback SET is_public = p_is_public WHERE id = p_feedback_id;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_admin_id, v_user_id, 'feedback_visibility_changed', 'feedback', p_feedback_id::text::uuid,
    'is_public set to ' || p_is_public::text);
END;
$$;

REVOKE EXECUTE ON FUNCTION set_feedback_public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_feedback_public TO authenticated;

-- archive_feedback: admin only
CREATE OR REPLACE FUNCTION archive_feedback(
  p_feedback_id uuid,
  p_archived boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_user_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_user_id FROM feedback WHERE id = p_feedback_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Feedback not found' USING ERRCODE = '42704';
  END IF;

  IF p_archived THEN
    UPDATE feedback SET archived_at = now(), archived_by = v_admin_id, status = 'archived'
    WHERE id = p_feedback_id;
  ELSE
    UPDATE feedback SET archived_at = NULL, archived_by = NULL
    WHERE id = p_feedback_id;
  END IF;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_admin_id, v_user_id, 'feedback_archived', 'feedback', p_feedback_id::text::uuid,
    'archived = ' || p_archived::text);
END;
$$;

REVOKE EXECUTE ON FUNCTION archive_feedback FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION archive_feedback TO authenticated;

-- add_feedback_internal_note: admin only
CREATE OR REPLACE FUNCTION add_feedback_internal_note(
  p_feedback_id uuid,
  p_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_new_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  IF btrim(p_note) = '' OR length(p_note) > 5000 THEN
    RAISE EXCEPTION 'Invalid note' USING ERRCODE = '23514';
  END IF;

  INSERT INTO feedback_internal_notes (feedback_id, admin_id, note)
  VALUES (p_feedback_id, v_admin_id, p_note)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION add_feedback_internal_note FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION add_feedback_internal_note TO authenticated;