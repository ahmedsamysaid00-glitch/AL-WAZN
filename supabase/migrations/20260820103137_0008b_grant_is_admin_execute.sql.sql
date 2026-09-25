-- Grant EXECUTE on is_admin() to authenticated so RLS policies can call it.
-- The function is SECURITY DEFINER, so it runs with owner privileges regardless.
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
