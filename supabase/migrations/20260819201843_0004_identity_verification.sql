/*
# AL-WAZN Phase 2: Identity Verification System

## Purpose
Adds a production-ready identity verification workflow:
- Users submit verification requests with identity documents
- Admins review, approve, or reject requests via secure SECURITY DEFINER functions
- Profile verification state is protected at the database level
- All admin actions are recorded in an immutable audit log
- Identity documents are stored in a private storage bucket with per-user folder isolation

## 1. Enums

### `verification_status`
- `unverified` — default, no verification submitted
- `pending` — request submitted, awaiting admin review
- `approved` — admin approved the verification
- `rejected` — admin rejected the verification

### `document_type`
- `passport`
- `national_id`
- `driver_license`

### `verification_request_status`
- `pending` — awaiting review
- `approved` — approved by admin
- `rejected` — rejected by admin

### `audit_action`
- `verification_approved`
- `verification_rejected`

## 2. Profile Changes
Adds two columns to the existing `profiles` table:
- `verification_status` (verification_status, default 'unverified')
- `identity_verified` (boolean, default false)

These are PROTECTED: the `guard_profile_fields` trigger (from Phase 1) is extended
to block client changes to these columns. Only the admin SECURITY DEFINER functions
can modify them (they run with elevated privileges and bypass the trigger's check
by setting a session variable).

## 3. New Tables

### `verification_requests`
- `id` (uuid PK)
- `user_id` (uuid FK → profiles.id ON DELETE CASCADE)
- `full_name` (text, not null)
- `date_of_birth` (date, not null)
- `document_type` (document_type, not null)
- `document_number` (text, not null)
- `issuing_country` (text, not null, ISO 3166-1 alpha-2)
- `document_file_path` (text, not null — storage path)
- `status` (verification_request_status, default 'pending')
- `rejection_reason` (text, nullable)
- `submitted_at` (timestamptz, default now())
- `reviewed_at` (timestamptz, nullable)
- `reviewed_by` (uuid FK → profiles.id, nullable)
- `created_at`, `updated_at` (timestamptz)

Constraints:
- One active pending request per user (partial unique index on user_id WHERE status='pending')
- document_number not empty
- issuing_country is 2-letter uppercase

### `audit_logs`
- `id` (uuid PK)
- `admin_id` (uuid FK → profiles.id)
- `target_user_id` (uuid FK → profiles.id)
- `action` (audit_action, not null)
- `entity_type` (text, not null)
- `entity_id` (uuid, not null)
- `reason` (text, nullable)
- `created_at` (timestamptz, default now())

Immutable: no UPDATE or DELETE policies. Only the admin functions insert audit records.

## 4. Functions

### `admin_approve_verification(p_request_id uuid)`
SECURITY DEFINER, search_path locked. Steps:
1. Verify caller is authenticated and is admin (via is_admin)
2. Lock the verification request row
3. Verify request status is 'pending'
4. Update request: status='approved', reviewed_at=now(), reviewed_by=caller
5. Update profile: verification_status='approved', identity_verified=true, account_status='active'
6. Insert audit log record
Returns the updated request or raises an error.

### `admin_reject_verification(p_request_id uuid, p_reason text)`
SECURITY DEFINER, search_path locked. Steps:
1. Verify caller is authenticated and is admin
2. Lock the verification request row
3. Verify request status is 'pending'
4. Update request: status='rejected', rejection_reason, reviewed_at, reviewed_by
5. Update profile: verification_status='rejected', identity_verified=false
6. Insert audit log record
Returns the updated request or raises an error.

Both functions set `SET LOCAL app.bypass_guard = 'on'` before updating profiles,
which the extended `guard_profile_fields` trigger checks to allow the privileged
update while still blocking client-level attempts.

## 5. Storage
Creates a PRIVATE storage bucket `identity-documents`.
Storage policies:
- Users can upload only to their own folder: `{user_id}/...`
- Users can read only their own documents
- Admins can read all documents (for review)
- No public access

## 6. RLS Policies

### verification_requests
- SELECT: own requests OR admin
- INSERT: own requests only, status must be 'pending', user must not already have a pending request
- UPDATE: admin only (and only status/rejection_reason/reviewed_at/reviewed_by)
- DELETE: admin only

### audit_logs
- SELECT: admin only
- INSERT: none for client roles (only via SECURITY DEFINER functions)
- UPDATE/DELETE: none (immutable)

## 7. Security Notes
1. Normal users can NEVER modify verification_status, identity_verified, role, or account_status.
   The guard trigger blocks all such attempts.
2. The admin functions are the ONLY path to approve/reject verification.
3. Audit logs are append-only — no client can insert, update, or delete them.
4. Identity documents are private — no public URLs, only signed URLs for admin review.
5. The database is the authority. Frontend restrictions are convenience, not security.
*/

-- ============================================================
-- 1. ENUMS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE verification_status AS ENUM ('unverified', 'pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE document_type AS ENUM ('passport', 'national_id', 'driver_license');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE verification_request_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE audit_action AS ENUM ('verification_approved', 'verification_rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. PROFILE COLUMNS
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'verification_status'
  ) THEN
    ALTER TABLE profiles ADD COLUMN verification_status verification_status NOT NULL DEFAULT 'unverified';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'identity_verified'
  ) THEN
    ALTER TABLE profiles ADD COLUMN identity_verified boolean NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_verification_status ON profiles (verification_status);

-- ============================================================
-- 3. VERIFICATION_REQUESTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  date_of_birth date NOT NULL,
  document_type document_type NOT NULL,
  document_number text NOT NULL,
  issuing_country text NOT NULL,
  document_file_path text NOT NULL,
  status verification_request_status NOT NULL DEFAULT 'pending',
  rejection_reason text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vr_document_number_not_empty CHECK (char_length(trim(document_number)) > 0),
  CONSTRAINT vr_country_format CHECK (char_length(issuing_country) = 2 AND issuing_country = upper(issuing_country)),
  CONSTRAINT vr_dob_not_future CHECK (date_of_birth <= current_date)
);

CREATE INDEX IF NOT EXISTS idx_vr_user_id ON verification_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_vr_status ON verification_requests (status);
CREATE INDEX IF NOT EXISTS idx_vr_submitted_at ON verification_requests (submitted_at DESC);

-- One active pending request per user
CREATE UNIQUE INDEX IF NOT EXISTS uq_vr_one_pending_per_user
  ON verification_requests (user_id) WHERE status = 'pending';

-- updated_at trigger
CREATE OR REPLACE FUNCTION vr_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vr_updated_at ON verification_requests;
CREATE TRIGGER vr_updated_at
  BEFORE UPDATE ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION vr_set_updated_at();

-- Guard: block client changes to status, reviewed_at, reviewed_by, rejection_reason
CREATE OR REPLACE FUNCTION guard_verification_request_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admin functions (which bypass via session var) can change these
  IF current_setting('app.bypass_guard', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Cannot modify verification request status directly';
  END IF;
  IF NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
    RAISE EXCEPTION 'Cannot modify reviewed_at directly';
  END IF;
  IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by THEN
    RAISE EXCEPTION 'Cannot modify reviewed_by directly';
  END IF;
  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'Cannot modify rejection_reason directly';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vr_guard_fields ON verification_requests;
CREATE TRIGGER vr_guard_fields
  BEFORE UPDATE ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION guard_verification_request_fields();

REVOKE EXECUTE ON FUNCTION guard_verification_request_fields() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4. AUDIT_LOGS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action audit_action NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_admin_id ON audit_logs (admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_target_user_id ON audit_logs (target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs (created_at DESC);

-- ============================================================
-- 5. EXTEND guard_profile_fields FOR VERIFICATION COLUMNS
-- ============================================================

CREATE OR REPLACE FUNCTION guard_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admin functions bypass the guard via session variable
  IF current_setting('app.bypass_guard', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'Cannot change profile id';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Cannot change profile role';
  END IF;
  IF NEW.account_status IS DISTINCT FROM OLD.account_status AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Cannot change account status';
  END IF;
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    RAISE EXCEPTION 'Cannot change verification status';
  END IF;
  IF NEW.identity_verified IS DISTINCT FROM OLD.identity_verified THEN
    RAISE EXCEPTION 'Cannot change identity verified flag';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION guard_profile_fields() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 6. ADMIN VERIFICATION FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION admin_approve_verification(p_request_id uuid)
RETURNS verification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request verification_requests;
  v_admin_id uuid;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Lock the request row
  SELECT * INTO v_request
  FROM verification_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification request not found';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  -- Update the request
  UPDATE verification_requests
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = v_admin_id
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  -- Update the profile (bypass guard)
  PERFORM set_config('app.bypass_guard', 'on', true);
  UPDATE profiles
  SET verification_status = 'approved',
      identity_verified = true,
      account_status = 'active'
  WHERE id = v_request.user_id;
  PERFORM set_config('app.bypass_guard', 'off', true);

  -- Insert audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (v_admin_id, v_request.user_id, 'verification_approved', 'verification_request', p_request_id);

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION admin_reject_verification(p_request_id uuid, p_reason text)
RETURNS verification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request verification_requests;
  v_admin_id uuid;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_reason IS NULL OR char_length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  -- Lock the request row
  SELECT * INTO v_request
  FROM verification_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification request not found';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  -- Update the request
  UPDATE verification_requests
  SET status = 'rejected',
      rejection_reason = trim(p_reason),
      reviewed_at = now(),
      reviewed_by = v_admin_id
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  -- Update the profile (bypass guard)
  PERFORM set_config('app.bypass_guard', 'on', true);
  UPDATE profiles
  SET verification_status = 'rejected',
      identity_verified = false
  WHERE id = v_request.user_id;
  PERFORM set_config('app.bypass_guard', 'off', true);

  -- Insert audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_admin_id, v_request.user_id, 'verification_rejected', 'verification_request', p_request_id, trim(p_reason));

  RETURN v_request;
END;
$$;

-- Revoke direct execution from client roles; only allow authenticated (the function
-- itself checks admin status, so authenticated is needed to call it, but anon is blocked)
REVOKE EXECUTE ON FUNCTION admin_approve_verification(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION admin_reject_verification(uuid, text) FROM PUBLIC, anon;

-- ============================================================
-- 7. RLS ON verification_requests
-- ============================================================

ALTER TABLE verification_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vr_select_own_or_admin" ON verification_requests;
CREATE POLICY "vr_select_own_or_admin"
ON verification_requests FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "vr_insert_own" ON verification_requests;
CREATE POLICY "vr_insert_own"
ON verification_requests FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM verification_requests vr
    WHERE vr.user_id = auth.uid() AND vr.status = 'pending'
  )
);

DROP POLICY IF EXISTS "vr_update_admin_only" ON verification_requests;
CREATE POLICY "vr_update_admin_only"
ON verification_requests FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "vr_delete_admin_only" ON verification_requests;
CREATE POLICY "vr_delete_admin_only"
ON verification_requests FOR DELETE
TO authenticated
USING (public.is_admin());

GRANT SELECT, INSERT ON verification_requests TO authenticated;

-- ============================================================
-- 8. RLS ON audit_logs
-- ============================================================

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_select_admin_only" ON audit_logs;
CREATE POLICY "audit_select_admin_only"
ON audit_logs FOR SELECT
TO authenticated
USING (public.is_admin());

-- No INSERT/UPDATE/DELETE policies = deny by default for client roles
-- Audit logs are only inserted by the SECURITY DEFINER admin functions

GRANT SELECT ON audit_logs TO authenticated;

-- ============================================================
-- 9. STORAGE BUCKET
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'identity-documents',
  'identity-documents',
  false,
  10485760, -- 10MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 10. STORAGE POLICIES
-- ============================================================

-- Users can upload to their own folder only
DROP POLICY IF EXISTS "storage_vr_upload_own" ON storage.objects;
CREATE POLICY "storage_vr_upload_own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'identity-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Users can read their own documents only
DROP POLICY IF EXISTS "storage_vr_read_own" ON storage.objects;
CREATE POLICY "storage_vr_read_own"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'identity-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Admins can read all documents for review
DROP POLICY IF EXISTS "storage_vr_read_admin" ON storage.objects;
CREATE POLICY "storage_vr_read_admin"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'identity-documents'
  AND public.is_admin()
);

-- Users can delete their own documents (e.g., to replace before submission)
DROP POLICY IF EXISTS "storage_vr_delete_own" ON storage.objects;
CREATE POLICY "storage_vr_delete_own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'identity-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- No update policy needed for storage objects
