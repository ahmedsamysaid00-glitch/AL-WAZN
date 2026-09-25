/*
# Phase 4 — Public Ideas Read RPCs

## Purpose
Provides efficient, secure server-side functions for the Community Ideas page.
These functions return only public-safe suggestion data with aggregated vote counts,
avoiding N+1 queries and preventing any leakage of private feedback or creator identity.

## 1. New Functions

### get_public_feedback_ideas(p_page, p_page_size, p_sort, p_category, p_search)
- Returns a page of public suggestions with vote_count and has_voted for the current user.
- Enforces: type = 'suggestion', is_public = true, archived_at IS NULL,
  status NOT IN ('archived', 'rejected'), type <> 'security_report' (implicit).
- Never returns user_id, internal notes, technical context, or any private field.
- Supports sorting by 'latest' or 'most_voted'.
- Optional category filter and case-insensitive search on title/message.
- Returns total_count alongside the page rows.

### get_public_feedback_idea(p_feedback_id)
- Returns a single public suggestion with vote_count, has_voted, and public-safe fields.
- Independently enforces all visibility rules — cannot retrieve private feedback by ID.
- Never returns user_id or any identifying information.

## 2. Security
- Both functions are SECURITY DEFINER with SET search_path = public.
- Both verify auth.uid() IS NOT NULL and role is 'traveler' or 'sender'.
- Both explicitly exclude security reports even if is_public were somehow true.
- Both exclude archived (archived_at IS NOT NULL) and rejected/closed-archived statuses.
- Revoked from PUBLIC, anon. Granted to authenticated only.
- No RLS policies are changed. No existing functions are modified.

## 3. Performance
- Vote counts computed via LEFT JOIN + GROUP BY (no N+1).
- has_voted computed via correlated subquery on the current user's vote.
- Uses the existing idx_feedback_public_suggestions partial index for filtering.
*/

-- ============================================================
-- get_public_feedback_ideas: paginated list with vote counts
-- ============================================================

CREATE OR REPLACE FUNCTION get_public_feedback_ideas(
  p_page int DEFAULT 0,
  p_page_size int DEFAULT 10,
  p_sort text DEFAULT 'latest',
  p_category feedback_category DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  title text,
  message text,
  category feedback_category,
  status feedback_status,
  proposed_solution text,
  created_at timestamptz,
  vote_count bigint,
  has_voted boolean,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_offset int;
  v_total bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  IF v_role NOT IN ('traveler', 'sender') THEN
    RAISE EXCEPTION 'Only travelers and senders can view public ideas' USING ERRCODE = '42501';
  END IF;

  -- Clamp page size
  IF p_page_size < 1 OR p_page_size > 50 THEN
    p_page_size := 10;
  END IF;
  IF p_page < 0 THEN
    p_page := 0;
  END IF;
  v_offset := p_page * p_page_size;

  -- Get total count
  SELECT count(*) INTO v_total
  FROM feedback
  WHERE type = 'suggestion'
    AND is_public = true
    AND archived_at IS NULL
    AND status NOT IN ('archived', 'rejected')
    AND (p_category IS NULL OR category = p_category)
    AND (
      p_search IS NULL
      OR p_search = ''
      OR title ILIKE '%' || p_search || '%'
      OR message ILIKE '%' || p_search || '%'
    );

  RETURN QUERY
  SELECT
    f.id,
    f.title,
    f.message,
    f.category,
    f.status,
    f.proposed_solution,
    f.created_at,
    COALESCE(v.vote_count, 0) AS vote_count,
    EXISTS(
      SELECT 1 FROM feedback_votes fv
      WHERE fv.feedback_id = f.id AND fv.user_id = v_user_id
    ) AS has_voted,
    v_total AS total_count
  FROM feedback f
  LEFT JOIN (
    SELECT feedback_id, count(*) AS vote_count
    FROM feedback_votes
    GROUP BY feedback_id
  ) v ON v.feedback_id = f.id
  WHERE f.type = 'suggestion'
    AND f.is_public = true
    AND f.archived_at IS NULL
    AND f.status NOT IN ('archived', 'rejected')
    AND (p_category IS NULL OR f.category = p_category)
    AND (
      p_search IS NULL
      OR p_search = ''
      OR f.title ILIKE '%' || p_search || '%'
      OR f.message ILIKE '%' || p_search || '%'
    )
  ORDER BY
    CASE WHEN p_sort = 'most_voted' THEN COALESCE(v.vote_count, 0) END DESC,
    CASE WHEN p_sort = 'most_voted' THEN f.created_at END DESC,
    CASE WHEN p_sort <> 'most_voted' THEN f.created_at END DESC
  LIMIT p_page_size
  OFFSET v_offset;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_public_feedback_ideas FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_public_feedback_ideas TO authenticated;

-- ============================================================
-- get_public_feedback_idea: single public idea detail
-- ============================================================

CREATE OR REPLACE FUNCTION get_public_feedback_idea(p_feedback_id uuid)
RETURNS TABLE(
  id uuid,
  title text,
  message text,
  category feedback_category,
  status feedback_status,
  proposed_solution text,
  created_at timestamptz,
  vote_count bigint,
  has_voted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  IF v_role NOT IN ('traveler', 'sender') THEN
    RAISE EXCEPTION 'Only travelers and senders can view public ideas' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.title,
    f.message,
    f.category,
    f.status,
    f.proposed_solution,
    f.created_at,
    COALESCE(v.vote_count, 0) AS vote_count,
    EXISTS(
      SELECT 1 FROM feedback_votes fv
      WHERE fv.feedback_id = f.id AND fv.user_id = v_user_id
    ) AS has_voted
  FROM feedback f
  LEFT JOIN (
    SELECT feedback_id, count(*) AS vote_count
    FROM feedback_votes
    WHERE feedback_id = p_feedback_id
    GROUP BY feedback_id
  ) v ON v.feedback_id = f.id
  WHERE f.id = p_feedback_id
    AND f.type = 'suggestion'
    AND f.is_public = true
    AND f.archived_at IS NULL
    AND f.status NOT IN ('archived', 'rejected');
END;
$$;

REVOKE EXECUTE ON FUNCTION get_public_feedback_idea FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_public_feedback_idea TO authenticated;
