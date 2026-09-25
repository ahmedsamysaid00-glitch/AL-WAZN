-- Sync auth.users.email -> profiles.email when the auth email changes
-- (e.g. after a user confirms an email-change request via Supabase Auth).
-- This keeps profiles.email in sync without any frontend writing to profiles.

CREATE OR REPLACE FUNCTION public.sync_profile_email_on_auth_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only update profiles when the email actually changed
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
    SET email = NEW.email, updated_at = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;

CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email_on_auth_update();

-- Revoke public/anon execute on the sync function
REVOKE EXECUTE ON FUNCTION public.sync_profile_email_on_auth_update() FROM PUBLIC, anon;