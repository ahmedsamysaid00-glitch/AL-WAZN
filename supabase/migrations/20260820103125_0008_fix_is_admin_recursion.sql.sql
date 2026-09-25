-- Fix infinite recursion in is_admin(): the function queries `profiles` which has
-- an RLS policy that calls is_admin(), causing stack overflow under authenticated sessions.
-- Switch to SECURITY DEFINER so the internal query runs with the function owner's
-- privileges (bypassing RLS), breaking the recursive cycle.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT EXISTS (
  SELECT 1 FROM profiles
  WHERE id = auth.uid() AND role = 'admin'
);
$function$;

-- Revoke direct execution from anon/authenticated — callers get it via RLS policy evaluation
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
