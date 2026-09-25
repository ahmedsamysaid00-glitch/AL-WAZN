/*
# Support Dashboard Stats RPC

1. New Function
- `get_support_stats()` — returns real statistics for the support dashboard:
  - openCount: support conversations with status 'open'
  - unreadCount: support conversations where the last message was sent by a user (not support), meaning support hasn't replied yet
  - waitingCount: same as unreadCount (waiting for support reply)
  - recentCount: support conversations updated in the last 24 hours

2. Security
- SECURITY DEFINER with safe search_path.
- Only callable by authenticated users with the 'support' role.
- Revoked from anon.
*/

CREATE OR REPLACE FUNCTION public.get_support_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_open_count int;
  v_unread_count int;
  v_recent_count int;
BEGIN
  IF NOT public.is_support() THEN
    RAISE EXCEPTION 'Access denied: support role required';
  END IF;

  SELECT count(*) INTO v_open_count
  FROM public.conversations
  WHERE context_type = 'support' AND support_status = 'open';

  -- Unread = open conversations where the last message was from the user (not from support)
  SELECT count(*) INTO v_unread_count
  FROM public.conversations c
  WHERE c.context_type = 'support'
    AND c.support_status = 'open'
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.conversation_id = c.id
        AND m.sender_id = c.traveler_id
        AND m.read_at IS NULL
    );

  SELECT count(*) INTO v_recent_count
  FROM public.conversations
  WHERE context_type = 'support'
    AND updated_at > now() - interval '24 hours';

  RETURN json_build_object(
    'openCount', v_open_count,
    'unreadCount', v_unread_count,
    'waitingCount', v_unread_count,
    'recentCount', v_recent_count
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_support_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_support_stats() TO authenticated;
