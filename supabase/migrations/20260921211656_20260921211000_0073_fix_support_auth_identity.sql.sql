/*
# Fix Support Account Auth Identity

1. Purpose
- The support account ahmedsamysayed00@gmail.com was created via direct SQL INSERT
  into auth.users. This bypassed Supabase's GoTrue auth server, which normally
  also creates a row in auth.identities. Without an auth.identities row,
  signInWithPassword rejects the credentials with "Invalid login credentials".
- This migration creates the missing auth.identities row so the account can
  authenticate normally via email/password.

2. Changes
- Inserts a row into auth.identities for the support user, matching the exact
  format used by existing working accounts (provider='email', provider_id=user_id,
  identity_data with sub/email/email_verified fields).
- Updates the encrypted_password to use bcrypt cost $2a$10$ (matching the
  format used by all other auth users in this project) with a fresh hash.

3. Security
- No RLS changes.
- No policy changes.
- No authentication logic changes.
- The account remains a standard email/password auth user.
- Authorization remains role-based via profiles.role = 'support'.
*/

-- Create the missing auth.identities row for the support account
INSERT INTO auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
SELECT
  id,
  id,
  jsonb_build_object(
    'sub', id,
    'role', 'sender',
    'email', email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  NULL,
  now(),
  now()
FROM auth.users
WHERE email = 'ahmedsamysayed00@gmail.com'
  AND id = '59317c06-951d-436e-9468-a8d406167198'
ON CONFLICT DO NOTHING;

-- Update the password hash to use bcrypt cost $2a$10$ (matching all other users)
UPDATE auth.users
SET encrypted_password = crypt('Support@2026!', gen_salt('bf', 10)),
    updated_at = now()
WHERE email = 'ahmedsamysayed00@gmail.com'
  AND id = '59317c06-951d-436e-9468-a8d406167198';
