/*
# Phase 6 — Feedback Analytics: Admin-only Aggregate RPCs

## Purpose
Provides server-side, admin-only aggregate analytics for the Feedback Analytics
dashboard. All functions return ONLY aggregate/minimal data — no user IDs,
emails, names, feedback messages, internal notes, or security report content.

## New Functions (all SECURITY DEFINER, SET search_path = public)

### 1. get_feedback_analytics(p_date_range)
Returns a single-row summary: avg_rating, total_rated, total_feedback,
new_count, resolved_count, resolution_rate, public_suggestions_count,
implemented_suggestions_count, security_reports_count.
Date range filters: '7d', '30d', '90d', '12m', 'all'.

### 2. get_feedback_rating_distribution(p_date_range)
Returns rows: rating (1-5), count.
Only counts feedback where rating IS NOT NULL.

### 3. get_feedback_category_stats(p_date_range)
Returns rows: category, feedback_count, percentage, avg_rating.
Only non-archived feedback. avg_rating is NULL if no ratings in that category.

### 4. get_feedback_role_stats(p_date_range)
Returns rows: user_type, total_feedback, avg_rating, rated_count.

### 5. get_feedback_satisfaction_over_time(p_date_range)
Returns rows: bucket (date label), avg_rating, rated_count.
Groups by day (7d/30d), week (90d), or month (12m). 'all' groups by month.
Only includes feedback with a non-null rating.
Returns NULL avg_rating (not 0) for buckets with no ratings — handled in UI.

### 6. get_feedback_top_ideas(p_limit)
Returns rows: id, title, category, vote_count, status.
Only public suggestions, non-archived, non-rejected.
Excludes user identity. Ordered by vote_count DESC.
No date filter (all-time community support).

### 7. get_feedback_implemented_suggestions(p_date_range, p_limit)
Returns rows: id, title, category, vote_count, resolved_at.
Only suggestions with status = 'resolved'.
No user identity. Ordered by updated_at DESC.

### 8. get_feedback_security_aggregate(p_date_range)
Returns a single row: total, new_count, under_review_count,
in_progress_count, resolved_count, closed_count, rejected_count.
No report content, no titles, no user info — just status counts.

## Security
- All functions verify public.is_admin() and raise 42501 if not admin.
- All use SET search_path = public.
- PUBLIC/anon execute revoked on all functions.
- Execute granted to authenticated (admin check is inside function body).
- No user IDs, emails, names, or feedback messages returned by any function.
- Security report analytics returns only aggregate status counts, never content.
- No existing RLS policies or tables modified.
- No USING(true) or WITH CHECK(true) anywhere.

## Index Review
Existing indexes from Phase 1 (idx_feedback_type, idx_feedback_status,
idx_feedback_category, idx_feedback_rating, idx_feedback_created_at,
idx_feedback_user_type, idx_feedback_is_public) cover all analytics queries.
No new indexes needed — all GROUP BY / WHERE clauses use indexed columns.
*/

-- ============================================================
-- Helper: date range CTE snippet
-- We inline the date filter in each function for clarity.
-- ============================================================

-- ============================================================
-- 1. get_feedback_analytics — summary metrics
-- ============================================================

CREATE OR REPLACE FUNCTION get_feedback_analytics(p_date_range text DEFAULT '30d')
RETURNS TABLE (
  avg_rating numeric,
  total_rated bigint,
  total_feedback bigint,
  new_count bigint,
  resolved_count bigint,
  resolution_rate numeric,
  public_suggestions_count bigint,
  implemented_suggestions_count bigint,
  security_reports_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_start timestamptz;
BEGIN
  SELECT public.is_admin() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  v_start := CASE
    WHEN p_date_range = '7d'  THEN now() - interval '7 days'
    WHEN p_date_range = '30d' THEN now() - interval '30 days'
    WHEN p_date_range = '90d' THEN now() - interval '90 days'
    WHEN p_date_range = '12m' THEN now() - interval '12 months'
    ELSE NULL -- 'all'
  END;

  RETURN QUERY
  SELECT
    AVG(rating) FILTER (WHERE rating IS NOT NULL)::numeric AS avg_rating,
    COUNT(*) FILTER (WHERE rating IS NOT NULL) AS total_rated,
    COUNT(*) AS total_feedback,
    COUNT(*) FILTER (WHERE status = 'new') AS new_count,
    COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_count,
    CASE
      WHEN COUNT(*) = 0 THEN NULL
      ELSE (COUNT(*) FILTER (WHERE status = 'resolved')::numeric / COUNT(*))
    END AS resolution_rate,
    COUNT(*) FILTER (WHERE is_public = true AND type = 'suggestion' AND archived_at IS NULL) AS public_suggestions_count,
    COUNT(*) FILTER (WHERE type = 'suggestion' AND status = 'resolved') AS implemented_suggestions_count,
    COUNT(*) FILTER (WHERE type = 'security_report') AS security_reports_count
  FROM feedback
  WHERE archived_at IS NULL
    AND (v_start IS NULL OR created_at >= v_start);
END;
$$;

REVOKE EXECUTE ON FUNCTION get_feedback_analytics FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_feedback_analytics TO authenticated;

-- ============================================================
-- 2. get_feedback_rating_distribution
-- ============================================================

CREATE OR REPLACE FUNCTION get_feedback_rating_distribution(p_date_range text DEFAULT '30d')
RETURNS TABLE (rating int, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_start timestamptz;
BEGIN
  SELECT public.is_admin() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  v_start := CASE
    WHEN p_date_range = '7d'  THEN now() - interval '7 days'
    WHEN p_date_range = '30d' THEN now() - interval '30 days'
    WHEN p_date_range = '90d' THEN now() - interval '90 days'
    WHEN p_date_range = '12m' THEN now() - interval '12 months'
    ELSE NULL
  END;

  RETURN QUERY
  SELECT r.rating, COUNT(f.rating) AS count
  FROM generate_series(1, 5) AS r(rating)
  LEFT JOIN feedback f ON f.rating = r.rating
    AND f.archived_at IS NULL
    AND (v_start IS NULL OR f.created_at >= v_start)
  GROUP BY r.rating
  ORDER BY r.rating;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_feedback_rating_distribution FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_feedback_rating_distribution TO authenticated;

-- ============================================================
-- 3. get_feedback_category_stats
-- ============================================================

CREATE OR REPLACE FUNCTION get_feedback_category_stats(p_date_range text DEFAULT '30d')
RETURNS TABLE (
  category feedback_category,
  feedback_count bigint,
  percentage numeric,
  avg_rating numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_start timestamptz;
  v_total bigint;
BEGIN
  SELECT public.is_admin() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  v_start := CASE
    WHEN p_date_range = '7d'  THEN now() - interval '7 days'
    WHEN p_date_range = '30d' THEN now() - interval '30 days'
    WHEN p_date_range = '90d' THEN now() - interval '90 days'
    WHEN p_date_range = '12m' THEN now() - interval '12 months'
    ELSE NULL
  END;

  SELECT COUNT(*) INTO v_total
  FROM feedback
  WHERE archived_at IS NULL
    AND (v_start IS NULL OR created_at >= v_start);

  RETURN QUERY
  SELECT
    f.category,
    COUNT(*) AS feedback_count,
    CASE WHEN v_total > 0 THEN (COUNT(*)::numeric / v_total) ELSE NULL END AS percentage,
    AVG(rating) FILTER (WHERE rating IS NOT NULL)::numeric AS avg_rating
  FROM feedback f
  WHERE f.archived_at IS NULL
    AND (v_start IS NULL OR f.created_at >= v_start)
  GROUP BY f.category
  ORDER BY feedback_count DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_feedback_category_stats FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_feedback_category_stats TO authenticated;

-- ============================================================
-- 4. get_feedback_role_stats
-- ============================================================

CREATE OR REPLACE FUNCTION get_feedback_role_stats(p_date_range text DEFAULT '30d')
RETURNS TABLE (
  user_type feedback_user_type,
  total_feedback bigint,
  avg_rating numeric,
  rated_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_start timestamptz;
BEGIN
  SELECT public.is_admin() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  v_start := CASE
    WHEN p_date_range = '7d'  THEN now() - interval '7 days'
    WHEN p_date_range = '30d' THEN now() - interval '30 days'
    WHEN p_date_range = '90d' THEN now() - interval '90 days'
    WHEN p_date_range = '12m' THEN now() - interval '12 months'
    ELSE NULL
  END;

  RETURN QUERY
  SELECT
    f.user_type,
    COUNT(*) AS total_feedback,
    AVG(rating) FILTER (WHERE rating IS NOT NULL)::numeric AS avg_rating,
    COUNT(*) FILTER (WHERE rating IS NOT NULL) AS rated_count
  FROM feedback f
  WHERE f.archived_at IS NULL
    AND (v_start IS NULL OR f.created_at >= v_start)
  GROUP BY f.user_type
  ORDER BY f.user_type;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_feedback_role_stats FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_feedback_role_stats TO authenticated;

-- ============================================================
-- 5. get_feedback_satisfaction_over_time
-- ============================================================

CREATE OR REPLACE FUNCTION get_feedback_satisfaction_over_time(p_date_range text DEFAULT '30d')
RETURNS TABLE (bucket text, avg_rating numeric, rated_count bigint)
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

  -- Daily for 7d/30d, weekly for 90d, monthly for 12m and all
  IF p_date_range = '7d' OR p_date_range = '30d' THEN
    RETURN QUERY
    SELECT
      to_char(d::date, 'YYYY-MM-DD') AS bucket,
      AVG(f.rating)::numeric AS avg_rating,
      COUNT(f.rating) AS rated_count
    FROM (
      SELECT generate_series(
        date_trunc('day', now() - CASE WHEN p_date_range = '7d' THEN interval '7 days' ELSE interval '30 days' END),
        date_trunc('day', now()),
        interval '1 day'
      ) AS d
    ) days
    LEFT JOIN feedback f
      ON f.rating IS NOT NULL
      AND f.archived_at IS NULL
      AND date_trunc('day', f.created_at) = d
    GROUP BY d
    ORDER BY d;
  ELSIF p_date_range = '90d' THEN
    RETURN QUERY
    SELECT
      to_char(d::date, 'IYYY-IW') AS bucket,
      AVG(f.rating)::numeric AS avg_rating,
      COUNT(f.rating) AS rated_count
    FROM (
      SELECT generate_series(
        date_trunc('week', now() - interval '90 days'),
        date_trunc('week', now()),
        interval '1 week'
      ) AS d
    ) weeks
    LEFT JOIN feedback f
      ON f.rating IS NOT NULL
      AND f.archived_at IS NULL
      AND date_trunc('week', f.created_at) = d
    GROUP BY d
    ORDER BY d;
  ELSE
    -- 12m or all: monthly
    RETURN QUERY
    SELECT
      to_char(d::date, 'YYYY-MM') AS bucket,
      AVG(f.rating)::numeric AS avg_rating,
      COUNT(f.rating) AS rated_count
    FROM (
      SELECT generate_series(
        date_trunc('month', now() - CASE WHEN p_date_range = '12m' THEN interval '12 months' ELSE interval '10 years' END),
        date_trunc('month', now()),
        interval '1 month'
      ) AS d
    ) months
    LEFT JOIN feedback f
      ON f.rating IS NOT NULL
      AND f.archived_at IS NULL
      AND date_trunc('month', f.created_at) = d
    GROUP BY d
    ORDER BY d;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_feedback_satisfaction_over_time FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_feedback_satisfaction_over_time TO authenticated;

-- ============================================================
-- 6. get_feedback_top_ideas — public suggestions by votes (all-time)
-- ============================================================

CREATE OR REPLACE FUNCTION get_feedback_top_ideas(p_limit int DEFAULT 10)
RETURNS TABLE (
  id uuid,
  title text,
  category feedback_category,
  vote_count bigint,
  status feedback_status
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

  IF p_limit < 1 OR p_limit > 50 THEN p_limit := 10; END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.title,
    f.category,
    COALESCE(v.vc, 0) AS vote_count,
    f.status
  FROM feedback f
  LEFT JOIN (
    SELECT feedback_id, COUNT(*) AS vc
    FROM feedback_votes
    GROUP BY feedback_id
  ) v ON v.feedback_id = f.id
  WHERE f.is_public = true
    AND f.type = 'suggestion'
    AND f.archived_at IS NULL
    AND f.status NOT IN ('rejected', 'archived')
  ORDER BY vote_count DESC, f.created_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_feedback_top_ideas FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_feedback_top_ideas TO authenticated;

-- ============================================================
-- 7. get_feedback_implemented_suggestions
-- ============================================================

CREATE OR REPLACE FUNCTION get_feedback_implemented_suggestions(
  p_date_range text DEFAULT '30d',
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  title text,
  category feedback_category,
  vote_count bigint,
  resolved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_start timestamptz;
BEGIN
  SELECT public.is_admin() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  IF p_limit < 1 OR p_limit > 50 THEN p_limit := 10; END IF;

  v_start := CASE
    WHEN p_date_range = '7d'  THEN now() - interval '7 days'
    WHEN p_date_range = '30d' THEN now() - interval '30 days'
    WHEN p_date_range = '90d' THEN now() - interval '90 days'
    WHEN p_date_range = '12m' THEN now() - interval '12 months'
    ELSE NULL
  END;

  RETURN QUERY
  SELECT
    f.id,
    f.title,
    f.category,
    COALESCE(v.vc, 0) AS vote_count,
    f.updated_at AS resolved_at
  FROM feedback f
  LEFT JOIN (
    SELECT feedback_id, COUNT(*) AS vc
    FROM feedback_votes
    GROUP BY feedback_id
  ) v ON v.feedback_id = f.id
  WHERE f.type = 'suggestion'
    AND f.status = 'resolved'
    AND (v_start IS NULL OR f.updated_at >= v_start)
  ORDER BY f.updated_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_feedback_implemented_suggestions FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_feedback_implemented_suggestions TO authenticated;

-- ============================================================
-- 8. get_feedback_security_aggregate — status counts only, no content
-- ============================================================

CREATE OR REPLACE FUNCTION get_feedback_security_aggregate(p_date_range text DEFAULT '30d')
RETURNS TABLE (
  total bigint,
  new_count bigint,
  under_review_count bigint,
  in_progress_count bigint,
  resolved_count bigint,
  closed_count bigint,
  rejected_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_start timestamptz;
BEGIN
  SELECT public.is_admin() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  v_start := CASE
    WHEN p_date_range = '7d'  THEN now() - interval '7 days'
    WHEN p_date_range = '30d' THEN now() - interval '30 days'
    WHEN p_date_range = '90d' THEN now() - interval '90 days'
    WHEN p_date_range = '12m' THEN now() - interval '12 months'
    ELSE NULL
  END;

  RETURN QUERY
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = 'new') AS new_count,
    COUNT(*) FILTER (WHERE status = 'under_review') AS under_review_count,
    COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress_count,
    COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_count,
    COUNT(*) FILTER (WHERE status = 'closed') AS closed_count,
    COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_count
  FROM feedback
  WHERE type = 'security_report'
    AND (v_start IS NULL OR created_at >= v_start);
END;
$$;

REVOKE EXECUTE ON FUNCTION get_feedback_security_aggregate FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_feedback_security_aggregate TO authenticated;