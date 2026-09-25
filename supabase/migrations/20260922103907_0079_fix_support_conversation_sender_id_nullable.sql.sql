-- Fix: get_or_create_support_conversation() fails because sender_id is NOT NULL
-- but the function inserts NULL for support conversations.
-- The migration 0064b intended sender_id to be nullable for support conversations
-- but only dropped NOT NULL on collaboration_id, not sender_id.

-- 1. Make sender_id nullable (support conversations have no "sender" party)
ALTER TABLE public.conversations ALTER COLUMN sender_id DROP NOT NULL;

-- 2. Add unique partial index to prevent duplicate OPEN support conversations
--    for the same user. This enforces the singleton constraint at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_support_unique_open
  ON public.conversations (traveler_id)
  WHERE context_type = 'support' AND support_status = 'open';

-- 3. Fix the RPC: use ON CONFLICT for atomic idempotency, handle the unique index
CREATE OR REPLACE FUNCTION public.get_or_create_support_conversation()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_conv_id uuid;
  v_user_role public.user_role;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT role INTO v_user_role FROM public.profiles WHERE id = v_user_id;
  IF v_user_role NOT IN ('traveler', 'sender') THEN
    RAISE EXCEPTION 'Only travelers and senders can contact support';
  END IF;

  -- Return existing open support conversation if one exists
  SELECT id INTO v_conv_id
  FROM public.conversations
  WHERE context_type = 'support'
    AND traveler_id = v_user_id
    AND support_status = 'open'
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  -- Create new support conversation.
  -- The unique partial index protects against concurrent duplicates:
  -- if two requests race, only one INSERT succeeds; the other gets
  -- a unique violation which we catch and handle by selecting the winner.
  BEGIN
    INSERT INTO public.conversations (context_type, traveler_id, sender_id, collaboration_id, support_status)
    VALUES ('support', v_user_id, NULL, NULL, 'open')
    RETURNING id INTO v_conv_id;
  EXCEPTION WHEN unique_violation THEN
    -- Concurrent insert won the race — fetch the existing row
    SELECT id INTO v_conv_id
    FROM public.conversations
    WHERE context_type = 'support'
      AND traveler_id = v_user_id
      AND support_status = 'open'
    LIMIT 1;
  END;

  RETURN v_conv_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_support_conversation() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_support_conversation() TO authenticated;
