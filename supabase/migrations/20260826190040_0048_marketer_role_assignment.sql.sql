/*
# Marketing System — Marketer Role Assignment RPC

## RPC
- assign_marketer_role(p_email text) — admin sets a user's role to 'marketing'
  Only works if the target user exists and is NOT an admin.
  Prevents creating a second marketer by checking existing marketing-role users.
  Audits the action.

## Provisioning
- Assigns 'marketing' role to mohamedsamysaid1@gmail.com if the profile exists
  and is currently not an admin.
*/

CREATE OR REPLACE FUNCTION assign_marketer_role(p_email text)
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result profiles%ROWTYPE;
  v_existing_marketer_count int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can assign the marketer role';
  END IF;

  IF p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  -- Don't allow demoting an admin to marketing
  SELECT * INTO v_result FROM profiles WHERE lower(email) = lower(trim(p_email));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found with email: %', p_email;
  END IF;

  IF v_result.role = 'admin' THEN
    RAISE EXCEPTION 'Cannot change an admin to marketing role';
  END IF;

  -- Check how many marketers already exist
  SELECT count(*) INTO v_existing_marketer_count
  FROM profiles WHERE role = 'marketing';

  IF v_existing_marketer_count > 0 AND v_result.role <> 'marketing' THEN
    -- Allow if we're re-assigning the same user, block if creating a second marketer
    RAISE EXCEPTION 'A marketer already exists. Only one marketer is allowed.';
  END IF;

  -- Update the user's role
  UPDATE profiles
  SET role = 'marketing', updated_at = now()
  WHERE id = v_result.id
  RETURNING * INTO v_result;

  -- Update platform_settings.marketer_email to match
  UPDATE platform_settings
  SET marketer_email = lower(trim(p_email))
  WHERE id = (SELECT id FROM platform_settings LIMIT 1);

  -- Audit log
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (auth.uid(), v_result.id, 'marketer_assigned', 'profile', v_result.id,
          'Assigned marketing role to ' || p_email);

  -- Notify the marketer
  INSERT INTO notifications (user_id, type, title, body)
  VALUES (v_result.id, 'marketer_assigned', 'Marketing Access Granted',
          'You have been assigned as the platform marketer. You now have access to the Marketing Dashboard.');

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION assign_marketer_role(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION assign_marketer_role(text) FROM anon, public;

-- ============================================================
-- Provision the marketer account if it exists
-- ============================================================
DO $$
DECLARE
  v_profile profiles%ROWTYPE;
  v_marketer_count int;
BEGIN
  SELECT * INTO v_profile FROM profiles WHERE lower(email) = 'mohamedsamysaid1@gmail.com';
  IF NOT FOUND THEN
    RAISE NOTICE 'Marketer profile not found yet — will be provisioned on first login via trigger';
    RETURN;
  END IF;

  IF v_profile.role = 'admin' THEN
    RAISE NOTICE 'Target marketer account is an admin — skipping';
    RETURN;
  END IF;

  SELECT count(*) INTO v_marketer_count FROM profiles WHERE role = 'marketing';
  IF v_marketer_count > 0 THEN
    RAISE NOTICE 'A marketer already exists — skipping provisioning';
    RETURN;
  END IF;

  UPDATE profiles SET role = 'marketing', updated_at = now() WHERE id = v_profile.id;

  UPDATE platform_settings
  SET marketer_email = 'mohamedsamysaid1@gmail.com'
  WHERE id = (SELECT id FROM platform_settings LIMIT 1);

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_profile.id, v_profile.id, 'marketer_assigned', 'profile', v_profile.id,
          'Auto-provisioned marketer role for mohamedsamysaid1@gmail.com');

  RAISE NOTICE 'Marketer provisioned successfully';
END $$;

-- ============================================================
-- Update handle_new_user trigger to accept 'marketing' role
-- (The existing trigger defaults unknown roles to 'sender'.
--  We update it so that if the user's email matches the marketer_email
--  in platform_settings, they get the 'marketing' role automatically.)
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  requested_role text;
  assigned_role user_role;
  v_full_name text;
  v_marketer_email text;
BEGIN
  requested_role := new.raw_user_meta_data->>'role';
  v_full_name := new.raw_user_meta_data->>'full_name';

  -- Check if this is the designated marketer email
  SELECT marketer_email INTO v_marketer_email FROM platform_settings LIMIT 1;

  IF v_marketer_email IS NOT NULL AND lower(new.email) = lower(v_marketer_email) THEN
    -- Check no marketer exists yet
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE role = 'marketing') THEN
      assigned_role := 'marketing'::user_role;
      INSERT INTO public.profiles (id, email, full_name, role, account_status)
      VALUES (new.id, new.email, v_full_name, assigned_role, 'active');
      RETURN new;
    END IF;
  END IF;

  IF requested_role = 'traveler' THEN
    assigned_role := 'traveler'::user_role;
  ELSIF requested_role = 'sender' THEN
    assigned_role := 'sender'::user_role;
  ELSE
    -- Any other value (including 'admin', 'marketing', NULL, or garbage) defaults to 'sender'.
    -- This prevents self-registration as admin or marketing.
    assigned_role := 'sender'::user_role;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, account_status)
  VALUES (new.id, new.email, v_full_name, assigned_role, 'pending');

  RETURN new;
END;
$$;
