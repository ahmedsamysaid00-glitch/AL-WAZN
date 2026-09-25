-- Fix handle_new_user trigger to correctly read role from user metadata.
--
-- ROOT CAUSE: The trigger read role from new.raw_app_meta_data, but the
-- Supabase client SDK's signUp() stores user-provided metadata in
-- raw_user_meta_data (not raw_app_meta_data). So requested_role was
-- always NULL, hitting the ELSE branch that defaulted to 'sender'.
-- This caused every registration — traveler or sender — to become sender.
--
-- FIX:
-- 1. Read role from new.raw_user_meta_data (where the SDK puts it)
-- 2. Read full_name from new.raw_user_meta_data and store it in profiles
-- 3. Explicitly reject 'admin' as a self-registered role (fall to 'sender')
-- 4. Only accept 'traveler' or 'sender'; anything else defaults to 'sender'
-- 5. Keep account_status = 'pending', verification_status = 'unverified',
--    identity_verified = false (via column defaults)

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  requested_role text;
  assigned_role user_role;
  v_full_name text;
BEGIN
  requested_role := new.raw_user_meta_data->>'role';
  v_full_name := new.raw_user_meta_data->>'full_name';

  IF requested_role = 'traveler' THEN
    assigned_role := 'traveler'::user_role;
  ELSIF requested_role = 'sender' THEN
    assigned_role := 'sender'::user_role;
  ELSE
    -- Any other value (including 'admin', NULL, or garbage) defaults to 'sender'.
    -- This prevents self-registration as admin.
    assigned_role := 'sender'::user_role;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, account_status)
  VALUES (new.id, new.email, v_full_name, assigned_role, 'pending');

  RETURN new;
END;
$function$;
