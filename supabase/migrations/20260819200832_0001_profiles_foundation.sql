/*
# AL-WAZN Foundation: Profiles, Roles, and Security

## Purpose
Establishes the core authentication and authorization foundation for the AL-WAZN
marketplace platform. This migration creates the user profiles system, role-based
access control, and row-level security policies that protect user data.

## 1. Enums
- `user_role`: traveler | sender | admin
- `account_status`: pending | active | suspended

## 2. Tables
### profiles (1:1 with auth.users)
- id (uuid PK, references auth.users)
- email (text, not null)
- full_name (text, nullable)
- role (user_role, default 'sender')
- account_status (account_status, default 'pending')
- created_at, updated_at (timestamptz)

## 3. Functions
- is_admin() — true if current user role is admin
- handle_new_user() — SECURITY DEFINER trigger creating profile on signup; only accepts traveler/sender, never admin
- profiles_set_updated_at() — bumps updated_at
- guard_profile_fields() — blocks client changes to role, account_status, id

## 4. Security (RLS)
- SELECT: own profile OR admin
- INSERT: deny-by-default (only via trigger)
- UPDATE: own profile OR admin (trigger guards privileged fields)
- DELETE: admin only

## 5. Notes
- First user is NOT auto-admin. Admins created server-side only.
- Self-registration as admin blocked at function + trigger levels.
- Database starts EMPTY — no seed data.
*/

-- Enums
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('traveler', 'sender', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE account_status AS ENUM ('pending', 'active', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  role user_role NOT NULL DEFAULT 'sender',
  account_status account_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_email_not_empty CHECK (char_length(trim(email)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles (role);
CREATE INDEX IF NOT EXISTS idx_profiles_account_status ON profiles (account_status);

-- is_admin()
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- handle_new_user: create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_role text;
  assigned_role user_role;
BEGIN
  requested_role := new.raw_app_meta_data->>'role';
  IF requested_role = 'traveler' THEN
    assigned_role := 'traveler'::user_role;
  ELSIF requested_role = 'sender' THEN
    assigned_role := 'sender'::user_role;
  ELSE
    assigned_role := 'sender'::user_role;
  END IF;

  INSERT INTO public.profiles (id, email, role, account_status)
  VALUES (new.id, new.email, assigned_role, 'pending');

  RETURN new;
END;
$$;

-- profiles_set_updated_at
CREATE OR REPLACE FUNCTION profiles_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- guard_profile_fields
CREATE OR REPLACE FUNCTION guard_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'Cannot change profile id';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Cannot change profile role';
  END IF;
  IF NEW.account_status IS DISTINCT FROM OLD.account_status AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Cannot change account status';
  END IF;
  RETURN NEW;
END;
$$;

-- Triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_set_updated_at();

DROP TRIGGER IF EXISTS profiles_guard_fields ON profiles;
CREATE TRIGGER profiles_guard_fields
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_fields();

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON profiles;
CREATE POLICY "profiles_select_own_or_admin"
ON profiles FOR SELECT
TO authenticated
USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON profiles;
CREATE POLICY "profiles_update_own_or_admin"
ON profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id OR public.is_admin())
WITH CHECK (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "profiles_delete_admin_only" ON profiles;
CREATE POLICY "profiles_delete_admin_only"
ON profiles FOR DELETE
TO authenticated
USING (public.is_admin());

-- Grants
GRANT SELECT, UPDATE ON profiles TO authenticated;
