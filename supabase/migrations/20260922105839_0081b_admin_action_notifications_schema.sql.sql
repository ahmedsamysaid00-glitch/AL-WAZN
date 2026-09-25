-- Admin Action Notifications System — Schema, Triggers, RLS
-- Extends notifications table with structured entity linking,
-- automatic trigger-based creation for role_change and verification requests,
-- admin-only access, and duplicate prevention.

-- ============================================================
-- 1. Add structured entity linking columns to notifications
-- ============================================================
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS related_entity_type text,
  ADD COLUMN IF NOT EXISTS related_entity_id uuid;

-- Index for efficient admin notification queries by entity
CREATE INDEX IF NOT EXISTS idx_notif_entity
  ON public.notifications (related_entity_type, related_entity_id)
  WHERE related_entity_type IS NOT NULL;

-- Index for admin action notification filtering by type + read status
CREATE INDEX IF NOT EXISTS idx_notif_admin_action
  ON public.notifications (type, is_read, created_at DESC)
  WHERE type IN ('admin_role_request', 'admin_verification_request', 'admin_account_deletion_request');

-- ============================================================
-- 2. Duplicate prevention: unique constraint on admin action notifications
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_admin_action_unique
  ON public.notifications (related_entity_type, related_entity_id)
  WHERE related_entity_type IN ('user_request', 'verification_request');

-- ============================================================
-- 3. SECURITY DEFINER function to create admin action notifications
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_admin_action_notification(
  p_entity_type text,
  p_entity_id uuid,
  p_notification_type notification_type,
  p_title text,
  p_body text,
  p_requester_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO notifications (user_id, type, title, body, related_entity_type, related_entity_id, is_read)
  SELECT id, p_notification_type, p_title, p_body, p_entity_type, p_entity_id, false
  FROM profiles WHERE role = 'admin'
  ON CONFLICT DO NOTHING;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_admin_action_notification(text, uuid, notification_type, text, text, uuid) FROM anon, PUBLIC;

-- ============================================================
-- 4. Trigger: notify admins when a new user_request is created
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_admins_user_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_requester_name text;
  v_current_role user_role;
  v_requested_role user_role;
  v_notif_type notification_type;
  v_title text;
  v_body text;
BEGIN
  IF NEW.status != 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT full_name, role INTO v_requester_name, v_current_role
  FROM profiles WHERE id = NEW.user_id;

  v_requested_role := NEW.requested_role;

  IF NEW.request_type = 'role_change' THEN
    v_notif_type := 'admin_role_request'::notification_type;
    v_title := 'Role change request requires review';
    v_body := COALESCE(v_requester_name, 'A user') || ' requested a role change' ||
      COALESCE(' from ' || v_current_role::text, '') ||
      COALESCE(' to ' || v_requested_role::text, '');
  ELSIF NEW.request_type = 'account_deletion' THEN
    v_notif_type := 'admin_account_deletion_request'::notification_type;
    v_title := 'Account deletion request requires review';
    v_body := COALESCE(v_requester_name, 'A user') || ' requested account deletion';
  ELSE
    v_notif_type := 'admin_role_request'::notification_type;
    v_title := 'User request requires review';
    v_body := COALESCE(v_requester_name, 'A user') || ' submitted a ' || NEW.request_type::text || ' request';
  END IF;

  PERFORM public.create_admin_action_notification(
    'user_request',
    NEW.id,
    v_notif_type,
    v_title,
    v_body,
    NEW.user_id
  );

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_admins_user_request() FROM anon, PUBLIC;

DROP TRIGGER IF EXISTS trg_notify_admins_user_request ON public.user_requests;
CREATE TRIGGER trg_notify_admins_user_request
  AFTER INSERT ON public.user_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_admins_user_request();

-- ============================================================
-- 5. Trigger: notify admins when a new verification_request is created
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_admins_verification_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_requester_name text;
BEGIN
  IF NEW.status != 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_requester_name
  FROM profiles WHERE id = NEW.user_id;

  PERFORM public.create_admin_action_notification(
    'verification_request',
    NEW.id,
    'admin_verification_request'::notification_type,
    'New identity verification request',
    COALESCE(v_requester_name, 'A user') || ' submitted an identity verification request',
    NEW.user_id
  );

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_admins_verification_request() FROM anon, PUBLIC;

DROP TRIGGER IF EXISTS trg_notify_admins_verification_request ON public.verification_requests;
CREATE TRIGGER trg_notify_admins_verification_request
  AFTER INSERT ON public.verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_admins_verification_request();

-- ============================================================
-- 6. RLS: Admin action notifications are admin-only
-- ============================================================
DROP POLICY IF EXISTS "notif_select_admin_action" ON public.notifications;
CREATE POLICY "notif_select_admin_action"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (
    type IN ('admin_role_request', 'admin_verification_request', 'admin_account_deletion_request')
    AND is_admin()
  );

DROP POLICY IF EXISTS "notif_update_admin_action" ON public.notifications;
CREATE POLICY "notif_update_admin_action"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (
    type IN ('admin_role_request', 'admin_verification_request', 'admin_account_deletion_request')
    AND is_admin()
  )
  WITH CHECK (
    type IN ('admin_role_request', 'admin_verification_request', 'admin_account_deletion_request')
    AND is_admin()
  );
