/*
# Phase 5 — Admin Feedback Center: Read & Summary RPCs

## Purpose
Provides server-side, admin-only read access to the feedback system for the
Admin Feedback Center. The existing Phase 1 RLS intentionally limits user reads
to own feedback + public suggestions; admin needs a broader view with
server-side filtering, search, sorting, and pagination.

## New Functions (all SECURITY DEFINER, SET search_path = public)

### 1. get_admin_feedback(p_page, p_page_size, p_sort, p_type, p_status, p_role, p_visibility, p_category, p_search)
Returns a paginated list of feedback records visible to admin, with:
  - Aggregated vote_count (LEFT JOIN + GROUP BY, no N+1)
  - Submitter profile (full_name, email, role) — admin is authorized to see this
  - total_count for pagination
Supports server-side search on title + message (ILIKE), filtering by
type/status/role/visibility/category, and sorting by newest/oldest/updated/votes.
Only callable by admin (is_admin() check).

### 2. get_admin_feedback_detail(p_feedback_id)
Returns a single feedback record with all admin-relevant fields including
technical context (source, page_url, device_type, etc.), vote_count, and
submitter profile. Independently verifies admin access — does not rely on the
list having already filtered. Admin is authorized to see security reports.

### 3. get_admin_feedback_summary()
Returns lightweight operational counters: total, new, under_review,
in_progress, resolved, security_reports. No analytics, no charts — just counts.
Only callable by admin.

## Security
- All three functions verify public.is_admin() and raise 42501 if not admin.
- All use SET search_path = public.
- PUBLIC/anon execute is revoked on all functions.
- Execute is granted to authenticated (admin check is inside the function body).
- No existing RLS policies are modified.
- No existing tables are modified.
- Security reports are returned to admin (admin is authorized) but are never
  exposed through public/user RPCs — those remain separate (Phase 4).
- Internal notes are NOT returned by these read functions; they are fetched
  separately only when admin opens a detail view (RLS already restricts to admin).
*/

-- ============================================================
-- 1. get_admin_feedback — paginated list with filters/search/sort
-- ============================================================

CREATE OR REPLACE FUNCTION get_admin_feedback(
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 10,
  p_sort text DEFAULT 'newest',
  p_type text DEFAULT 'all',
  p_status text DEFAULT 'all',
  p_role text DEFAULT 'all',
  p_visibility text DEFAULT 'all',
  p_category text DEFAULT 'all',
  p_search text DEFAULT NULL
)
RETURNS TABLE (
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
  archived_at timestamptz,
  archived_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  vote_count bigint,
  submitter_name text,
  submitter_email text,
  submitter_role text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset int;
  v_is_admin boolean;
BEGIN
  SELECT public.is_admin() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  -- Clamp page
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
    id, user_id, user_type, type, category, title, message, rating,
    status, is_public, is_sensitive, source, page_url, device_type,
    operating_system, browser, context_type, context_id,
    expected_behavior, proposed_solution, archived_at, archived_by,
    created_at, updated_at, vote_count, submitter_name, submitter_email,
    submitter_role, total_count
  FROM filtered
  ORDER BY
    CASE WHEN p_sort = 'oldest' THEN created_at END ASC,
    CASE WHEN p_sort = 'updated' THEN updated_at END DESC,
    CASE WHEN p_sort = 'votes' THEN vote_count END DESC,
    CASE WHEN p_sort NOT IN ('oldest', 'updated', 'votes') THEN created_at END DESC
  LIMIT p_page_size OFFSET v_offset;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_admin_feedback FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_admin_feedback TO authenticated;

-- ============================================================
-- 2. get_admin_feedback_detail — single record with full admin fields
-- ============================================================

CREATE OR REPLACE FUNCTION get_admin_feedback_detail(p_feedback_id uuid)
RETURNS TABLE (
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
  archived_at timestamptz,
  archived_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  vote_count bigint,
  submitter_name text,
  submitter_email text,
  submitter_role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    p.role AS submitter_role
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
$$;

REVOKE EXECUTE ON FUNCTION get_admin_feedback_detail FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_admin_feedback_detail TO authenticated;

-- ============================================================
-- 3. get_admin_feedback_summary — lightweight operational counters
-- ============================================================

CREATE OR REPLACE FUNCTION get_admin_feedback_summary()
RETURNS TABLE (
  total bigint,
  new_count bigint,
  under_review_count bigint,
  in_progress_count bigint,
  resolved_count bigint,
  security_reports_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  SELECT public.is_admin() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = 'new') AS new_count,
    COUNT(*) FILTER (WHERE status = 'under_review') AS under_review_count,
    COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress_count,
    COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_count,
    COUNT(*) FILTER (WHERE type = 'security_report') AS security_reports_count
  FROM feedback
  WHERE archived_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_admin_feedback_summary FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_admin_feedback_summary TO authenticated;