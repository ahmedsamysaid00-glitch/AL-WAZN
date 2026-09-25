/*
# Phase 6 — Fix feedback_status_changed notification content

## Purpose
The Phase 1 set_feedback_status RPC used hardcoded English strings for the
notification title/body. This replaces them with privacy-safe, language-neutral
notification content:
- Title: 'feedback_notif_title' (a translation key the frontend resolves)
- Body: 'feedback_notif_body_status:' || p_new_status (frontend resolves)

For security reports specifically, the body uses a separate key that does NOT
mention the report type or any sensitive details — just that the status was
updated.

The frontend already maps feedback_status_changed to a translated label in
UserNotificationsPage. The title/body are now translation keys that the
NotificationItem component will resolve via t().

## Security
- No security report content (title, category, message) is included in the
  notification body or title.
- Only the new status is referenced, which is safe — status is not sensitive.
- SECURITY DEFINER, SET search_path = public, admin-only (unchanged).
- No RLS changes. No table changes. Only the notification INSERT text changes.
*/

CREATE OR REPLACE FUNCTION set_feedback_status(
  p_feedback_id uuid,
  p_new_status feedback_status,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_old_status feedback_status;
  v_user_id uuid;
  v_type feedback_type;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT status, user_id, type INTO v_old_status, v_user_id, v_type
  FROM feedback WHERE id = p_feedback_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Feedback not found' USING ERRCODE = '42704';
  END IF;

  -- Update feedback status
  UPDATE feedback SET status = p_new_status WHERE id = p_feedback_id;

  -- Create status history record
  INSERT INTO feedback_status_history (feedback_id, old_status, new_status, changed_by, note)
  VALUES (p_feedback_id, v_old_status, p_new_status, v_admin_id, p_note);

  -- Log to audit_logs
  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (v_admin_id, v_user_id, 'feedback_status_changed', 'feedback', p_feedback_id::text::uuid, p_note);

  -- Send notification to feedback owner (only for meaningful status changes)
  -- Privacy-safe: uses translation keys, no sensitive content
  IF v_old_status <> p_new_status THEN
    IF v_type = 'security_report' THEN
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (
        v_user_id,
        'feedback_status_changed',
        'feedback_notif_security_title',
        'feedback_notif_security_body'
      );
    ELSE
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (
        v_user_id,
        'feedback_status_changed',
        'feedback_notif_title',
        'feedback_notif_body_status:' || p_new_status::text
      );
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_feedback_status FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_feedback_status TO authenticated;