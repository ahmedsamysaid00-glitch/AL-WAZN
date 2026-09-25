-- Fix: the unique index was preventing per-admin notification creation.
-- The original index UNIQUE(related_entity_type, related_entity_id) allowed
-- only ONE notification total per entity. We need one per admin user.
-- New index: UNIQUE(user_id, related_entity_type, related_entity_id) ensures
-- each admin gets exactly one notification per entity (no duplicates per admin).

DROP INDEX IF EXISTS public.idx_notif_admin_action_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_admin_action_unique
  ON public.notifications (user_id, related_entity_type, related_entity_id)
  WHERE related_entity_type IN ('user_request', 'verification_request');
