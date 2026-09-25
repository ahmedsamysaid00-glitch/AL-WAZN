-- Add email to the guarded profile fields so non-admin users cannot
-- change their email directly via a profiles UPDATE. Email changes
-- must go through the request_email_change → approve_email_change flow.
-- Admin RPCs that need to update email set app.bypass_guard = 'on' first.

CREATE OR REPLACE FUNCTION public.guard_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
IF NEW.email IS DISTINCT FROM OLD.email THEN
  RAISE EXCEPTION 'Cannot change email directly; use the email change request flow';
END IF;

RETURN NEW;
END;
$function$;

-- No privilege changes needed — the trigger already exists and just picks up the new function body.
