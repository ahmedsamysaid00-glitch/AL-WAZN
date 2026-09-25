/*
# Fix Ambiguous Column Reference in get_admin_feedback RPC

1. Root Cause
- The get_admin_feedback function returns a TABLE with columns like "id", "user_id", etc.
- The final SELECT references these columns without a table alias.
- PostgreSQL cannot determine if "id" refers to the output column or the CTE column,
  resulting in error 42702: column reference "id" is ambiguous.
- This causes the Admin Feedback Center to show "فشل تحميل الآراء" (failed to load feedback).

2. Fix
- Qualify all column references in the final SELECT with the "filtered" CTE alias
  (e.g., filtered.id instead of id).
- Same fix applied to the ORDER BY clause.

3. Security
- No changes to authorization logic (is_admin() check preserved).
- No changes to RLS.
- No changes to function parameters or return types.
- SECURITY DEFINER and search_path preserved.
*/

CREATE OR REPLACE FUNCTION public.get_admin_feedback(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 10,
  p_sort text DEFAULT 'newest',
  p_type text DEFAULT 'all',
  p_status text DEFAULT 'all',
  p_role text DEFAULT 'all',
  p_visibility text DEFAULT 'all',
  p_category text DEFAULT 'all',
  p_search text DEFAULT NULL
)
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
  submitter_role text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_offset int;
  v_is_admin boolean;
BEGIN
  SELECT public.is_admin() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  IF p_page < 1 THEN p_page := 1; END IF;
  IF p_page_size < 1 OR p_page_size > 100 THEN p_page_size := 10; END IF;
  v_offset := (p_page - 1) * p_page_size;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      f.*,
      COALESCE(v.vc, 0) AS vote_count,
      p.full_name AS submitter_name,
      p.email AS submitter_email,
      p.role AS submitter_role,
      COUNT(*) OVER() AS total_count
    FROM feedback f
    LEFT JOIN (
      SELECT feedback_id, COUNT(*) AS vc
      FROM feedback_votes
      GROUP BY feedback_id
    ) v ON v.feedback_id = f.id
    LEFT JOIN profiles p ON p.id = f.user_id
    WHERE
      (p_type = 'all' OR f.type::text = p_type)
      AND (p_status = 'all' OR f.status::text = p_status)
      AND (p_role = 'all' OR f.user_type::text = p_role)
      AND (
        p_visibility = 'all'
        OR (p_visibility = 'public' AND f.is_public = true)
        OR (p_visibility = 'private' AND f.is_public = false)
      )
      AND (p_category = 'all' OR f.category::text = p_category)
      AND (
        p_search IS NULL
        OR btrim(p_search) = ''
        OR f.title ILIKE '%' || p_search || '%'
        OR f.message ILIKE '%' || p_search || '%'
      )
  )
  SELECT
    filtered.id, filtered.user_id, filtered.user_type, filtered.type,
    filtered.category, filtered.title, filtered.message, filtered.rating,
    filtered.status, filtered.is_public, filtered.is_sensitive, filtered.source,
    filtered.page_url, filtered.device_type, filtered.operating_system,
    filtered.browser, filtered.context_type, filtered.context_id,
    filtered.expected_behavior, filtered.proposed_solution,
    filtered.archived_at, filtered.archived_by,
    filtered.created_at, filtered.updated_at, filtered.vote_count,
    filtered.submitter_name, filtered.submitter_email,
    filtered.submitter_role, filtered.total_count
  FROM filtered
  ORDER BY
    CASE WHEN p_sort = 'oldest' THEN filtered.created_at END ASC,
    CASE WHEN p_sort = 'updated' THEN filtered.updated_at END DESC,
    CASE WHEN p_sort = 'votes' THEN filtered.vote_count END DESC,
    CASE WHEN p_sort NOT IN ('oldest', 'updated', 'votes') THEN filtered.created_at END DESC
  LIMIT p_page_size OFFSET v_offset;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_admin_feedback FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_feedback TO authenticated;
