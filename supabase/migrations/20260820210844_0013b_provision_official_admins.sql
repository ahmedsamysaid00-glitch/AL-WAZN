-- Provision two official AL-WAZN administrator accounts.
-- These are existing auth.users who signed up normally; this migration
-- promotes ONLY their profile rows to admin status. No new users are created.

-- Bypass the guard_profile_fields trigger so the UPDATE can set role/status
SELECT set_config('app.bypass_guard', 'on', true);

-- Promote ahmedsamysaid00@gmail.com
UPDATE public.profiles
SET role = 'admin',
    account_status = 'active',
    verification_status = 'approved',
    identity_verified = true
WHERE email = 'ahmedsamysaid00@gmail.com'
  AND id = 'ba140cf3-12af-4acd-bde4-ab978d5ce4bc';

-- Promote collegemission2026@gmail.com
UPDATE public.profiles
SET role = 'admin',
    account_status = 'active',
    verification_status = 'approved',
    identity_verified = true
WHERE email = 'collegemission2026@gmail.com'
  AND id = 'ba71ab5c-2c4f-43de-8aa8-da31d057926c';

-- Insert audit log entries
INSERT INTO public.audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
VALUES
  ('ba140cf3-12af-4acd-bde4-ab978d5ce4bc', 'ba140cf3-12af-4acd-bde4-ab978d5ce4bc', 'admin_provisioned', 'profile', 'ba140cf3-12af-4acd-bde4-ab978d5ce4bc', 'Initial official AL-WAZN administrator provisioning — previous: sender/pending/unverified/false'),
  ('ba71ab5c-2c4f-43de-8aa8-da31d057926c', 'ba71ab5c-2c4f-43de-8aa8-da31d057926c', 'admin_provisioned', 'profile', 'ba71ab5c-2c4f-43de-8aa8-da31d057926c', 'Initial official AL-WAZN administrator provisioning — previous: sender/pending/unverified/false');

-- Turn the guard back on
SELECT set_config('app.bypass_guard', 'off', true);
