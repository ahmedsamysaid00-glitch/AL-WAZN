/*
# Fix get_admin_feedback_detail RPC: submitter_role Type Mismatch

1. Root Cause
- profiles.role is user_role enum but the function declares submitter_role
  as text, causing error 42804 when the detail RPC is called.

2. Fix
- Cast p.role::text in the SELECT.

3. Security
- No authorization, RLS, or parameter changes.
*/

CREATE OR REPLACE FUNCTION public.get_admin_feedback_detail(p_feedback_id uuid)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  user_type feedback_user_type,
  type feedback_type,
  category feedback_category,
  title text,
  message text,
  rating smallint,
  status feedback_status,
  is_public boolean,
  is_sensitive boolean,
  source text,
  page_url text,
  device_type text,
  operating_system text,
  browser text,
  context_type text,
  context_id uuid,
  expected_behavior text,
  proposed_solution text,
  archived_at timestamp with time zone,
  archived_by uuid,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  vote_count bigint,
  submitter_name text,
  submitter_email text,
  submitter_role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean;
BEGIN
  SELECT public.is_admin() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    f.id, f.user_id, f.user_type, f.type, f.category, f.title, f.message,
    f.rating, f.status, f.is_public, f.is_sensitive, f.source, f.page_url,
    f.device_type, f.operating_system, f.browser, f.context_type, f.context_id,
    f.expected_behavior, f.proposed_solution, f.archived_at, f.archived_by,
    f.created_at, f.updated_at,
    COALESCE(v.vc, 0) AS vote_count,
    p.full_name AS submitter_name,
    p.email AS submitter_email,
    p.role::text AS submitter_role
  FROM feedback f
  LEFT JOIN (
    SELECT feedback_id, COUNT(*) AS vc
    FROM feedback_votes
    WHERE feedback_id = p_feedback_id
    GROUP BY feedback_id
  ) v ON v.feedback_id = f.id
  LEFT JOIN profiles p ON p.id = f.user_id
  WHERE f.id = p_feedback_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_admin_feedback_detail FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_feedback_detail TO authenticated;
