/*
# Provision Official Support Account (Re-created via GoTrue)

1. Purpose
- The official Support contact email is ahmedsamysayed00@gmail.com.
- The auth user was re-created through the proper Supabase Auth signup API
  (GoTrue) so the password is hashed by GoTrue's own bcrypt implementation.
- The handle_new_user trigger created a profile with role='sender',
  account_status='pending'. This migration promotes ONLY that profile row
  to the 'support' role with active account status, matching the pattern
  used for admin provisioning in migration 0013b.

2. Changes
- Updates the profile for ahmedsamysayed00@gmail.com:
  - role: sender → support
  - account_status: pending → active
  - verification_status: unverified → approved
  - identity_verified: false → true
- Inserts an audit log entry documenting the provisioning.

3. Security
- Uses the app.bypass_guard session variable to bypass the guard_profile_fields
  trigger (same pattern as 0013b admin provisioning).
- No RLS policy changes.
- No new tables or columns.
- The support role only has access to support conversations and the support
  dashboard — no admin, financial, or payment permissions are granted.
- No password or password hash is stored in this migration.
*/

-- Bypass the guard_profile_fields trigger so the UPDATE can set role/status
SELECT set_config('app.bypass_guard', 'on', true);

-- Promote the support account
UPDATE public.profiles
SET role = 'support',
    account_status = 'active',
    verification_status = 'approved',
    identity_verified = true
WHERE email = 'ahmedsamysayed00@gmail.com';

-- Insert audit log entry
INSERT INTO public.audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
SELECT
  id, id, 'admin_provisioned'::audit_action, 'profile', id,
  'Official Support account provisioning via GoTrue signup — previous: sender/pending/unverified/false'
FROM public.profiles
WHERE email = 'ahmedsamysayed00@gmail.com';

-- Turn the guard back on
SELECT set_config('app.bypass_guard', 'off', true);
