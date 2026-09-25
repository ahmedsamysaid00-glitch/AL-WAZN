/*
# Provision Official Support Account

1. Purpose
- The official Support contact email is ahmedsamysayed00@gmail.com.
- The auth user was created (with a sender profile via the handle_new_user trigger).
- This migration promotes ONLY that profile row to the 'support' role with
  active account status, matching the pattern used for admin provisioning
  in migration 0013b.

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
*/

-- Bypass the guard_profile_fields trigger so the UPDATE can set role/status
SELECT set_config('app.bypass_guard', 'on', true);

-- Promote the support account
UPDATE public.profiles
SET role = 'support',
    account_status = 'active',
    verification_status = 'approved',
    identity_verified = true
WHERE email = 'ahmedsamysayed00@gmail.com'
  AND id = '59317c06-951d-436e-9468-a8d406167198';

-- Insert audit log entry
INSERT INTO public.audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
VALUES
  ('59317c06-951d-436e-9468-a8d406167198', '59317c06-951d-436e-9468-a8d406167198', 'admin_provisioned', 'profile', '59317c06-951d-436e-9468-a8d406167198', 'Official Support account provisioning — previous: sender/pending/unverified/false');

-- Turn the guard back on
SELECT set_config('app.bypass_guard', 'off', true);
