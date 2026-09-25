/*
# Support Messaging System — Step 2: Schema, RPCs, and RLS

1. New Types
- `conversation_context` enum: 'collaboration' (existing behavior) | 'support'

2. Modified Tables
- `conversations`:
  - `collaboration_id` is now nullable (support conversations have no collaboration).
  - `context_type` (conversation_context, NOT NULL, DEFAULT 'collaboration') — distinguishes support vs. user-to-user conversations.
  - `support_status` (text, NOT NULL, DEFAULT 'open', CHECK in 'open','closed') — only meaningful for support conversations.
  - `assigned_to` (uuid, FK profiles, ON DELETE SET NULL) — support agent assigned to a support conversation.
- Existing rows are backfilled to `context_type = 'collaboration'`.

3. New Indexes
- idx_conversations_context_type on conversations(context_type)
- idx_conversations_support_status on conversations(support_status) WHERE context_type = 'support'
- idx_conversations_assigned_to on conversations(assigned_to) WHERE context_type = 'support'
- idx_conversations_user_support on conversations(traveler_id, context_type) WHERE context_type = 'support'
- idx_messages_conversation_created on messages(conversation_id, created_at DESC)

4. New Functions (SECURITY DEFINER, safe search_path)
- `is_support()` — returns true if auth.uid() has role 'support'. Revoked from anon, granted to authenticated.
- `get_or_create_support_conversation()` — idempotent: returns existing open support conversation for the caller, or creates one. Only travelers/senders can call. The user is stored in `traveler_id`; `sender_id` and `collaboration_id` are NULL for support conversations.
- `send_message(p_conversation_id, p_content)` — updated to handle support conversations: the conversation's user (traveler_id) or any support agent may send. Moderation logic preserved. Notifications created for the correct recipient(s).

5. RLS Policies
- conversations:
  - `conv_select_own_support`: authenticated users can SELECT their own support conversations (traveler_id = auth.uid()) OR if they are support role.
  - `conv_update_support`: only support role can UPDATE support conversations (assign/close).
- messages:
  - `messages_select_support`: users can SELECT messages in their own support conversations; support can SELECT all support conversation messages.
- Existing collaboration conversation/message policies are not modified.

6. Realtime
- No changes needed — conversations and messages are already in the realtime publication.

7. Notifications
- The send_message function creates notifications for support messages:
  - When user sends: notifies all support-role users.
  - When support replies: notifies the user (traveler_id).
- No new notification tables or types — reuses the existing notifications table with type 'new_message'.

8. Important Notes
- Support role does NOT receive admin permissions.
- Support can only access support conversations, not collaboration conversations or any admin data.
- Existing user-to-user messaging, RLS, realtime, and notifications are unchanged.
*/

-- ============================================================
-- 1. Conversation context enum
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.conversation_context AS ENUM ('collaboration', 'support');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. Extend conversations table
-- ============================================================
ALTER TABLE public.conversations
  ALTER COLUMN collaboration_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS context_type public.conversation_context NOT NULL DEFAULT 'collaboration',
  ADD COLUMN IF NOT EXISTS support_status text NOT NULL DEFAULT 'open' CHECK (support_status IN ('open', 'closed')),
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Backfill existing rows
UPDATE public.conversations SET context_type = 'collaboration' WHERE context_type IS NULL;

-- ============================================================
-- 3. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_conversations_context_type ON public.conversations (context_type);
CREATE INDEX IF NOT EXISTS idx_conversations_support_status ON public.conversations (support_status) WHERE context_type = 'support';
CREATE INDEX IF NOT EXISTS idx_conversations_assigned_to ON public.conversations (assigned_to) WHERE context_type = 'support';
CREATE INDEX IF NOT EXISTS idx_conversations_user_support ON public.conversations (traveler_id, context_type) WHERE context_type = 'support';
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages (conversation_id, created_at DESC);

-- ============================================================
-- 4. is_support() helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_support()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'support'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_support() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_support() TO authenticated;

-- ============================================================
-- 5. get_or_create_support_conversation()
-- ============================================================
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

  -- Create new support conversation
  INSERT INTO public.conversations (context_type, traveler_id, sender_id, collaboration_id, support_status)
  VALUES ('support', v_user_id, NULL, NULL, 'open')
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_support_conversation() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_support_conversation() TO authenticated;

-- ============================================================
-- 6. Update send_message() to handle support conversations
-- ============================================================
CREATE OR REPLACE FUNCTION public.send_message(p_conversation_id uuid, p_content text)
RETURNS messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
  v_conv conversations%ROWTYPE;
  v_message messages%ROWTYPE;
  v_normalized text;
  v_compact text;
  v_compact_nospace text;
  v_email_spaced text;
  v_category text;
  v_recipient_id uuid;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;

  IF length(p_content) > 2000 THEN
    RAISE EXCEPTION 'Message must be 2000 characters or less';
  END IF;

  SELECT * INTO v_conv FROM conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  -- Authorization
  IF v_conv.context_type = 'support' THEN
    IF v_caller_id IS DISTINCT FROM v_conv.traveler_id AND NOT public.is_support() THEN
      RAISE EXCEPTION 'You are not authorized to send messages in this conversation';
    END IF;
  ELSE
    IF v_caller_id IS DISTINCT FROM v_conv.sender_id AND v_caller_id IS DISTINCT FROM v_conv.traveler_id THEN
      RAISE EXCEPTION 'You are not a participant in this conversation';
    END IF;
  END IF;

  -- Moderation (same logic as before)
  v_normalized := p_content;
  v_normalized := translate(v_normalized, '٠١٢٣٤٥٦٧٨٩', '0123456789');
  v_normalized := translate(v_normalized, '۰۱۲۳۴۵۶۷۸۹', '0123456789');
  v_normalized := lower(v_normalized);

  v_compact := regexp_replace(v_normalized, '[\s\-_.]+', '', 'g');
  v_compact_nospace := regexp_replace(v_compact, '[()\[\]{}]+', '', 'g');
  v_email_spaced := regexp_replace(v_normalized, '\s*@\s*', '@', 'g');

  v_category := NULL;

  IF v_compact ~ '(\+?[0-9]{8,15})' OR v_compact_nospace ~ '(\+?[0-9]{8,15})' THEN
    v_category := 'phone';
  ELSIF v_email_spaced ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' THEN
    v_category := 'email';
  ELSIF v_compact ~ 'https?://|www\.' THEN
    v_category := 'url';
  ELSIF v_compact ~ 'telegram|whatsapp|discord|wechat|skype|viber' THEN
    v_category := 'social_media';
  ELSIF v_compact ~ 'instagram\.com|facebook\.com|tiktok\.com|snapchat\.com|twitter\.com|linkedin\.com' THEN
    v_category := 'social_media';
  ELSIF v_normalized ~ 'انستجرام|انستقرام|فيسبوك|تيك\s*توك|تيكتوك|سناب\s*شات|تويتر|تيليجرام|واتساب|ديسكورد' THEN
    v_category := 'social_media';
  ELSIF v_normalized ~ 'تواصل|اتصل|رقمي|رقمي الخاص|الرقم|واتس|تليجرام|تيليجرام' THEN
    v_category := 'contact_request';
  END IF;

  IF v_category IS NOT NULL THEN
    RAISE EXCEPTION 'Message blocked: %' , v_category USING ERRCODE = '45000';
  END IF;

  -- Insert message
  INSERT INTO messages (conversation_id, sender_id, message_text)
  VALUES (p_conversation_id, v_caller_id, p_content)
  RETURNING * INTO v_message;

  -- Update conversation timestamp
  UPDATE conversations SET last_message_at = now(), updated_at = now()
  WHERE id = p_conversation_id;

  -- Notifications
  IF v_conv.context_type = 'support' THEN
    IF v_caller_id = v_conv.traveler_id THEN
      -- User sent to support: notify all support agents
      INSERT INTO notifications (user_id, type, title, body, related_conversation_id)
      SELECT id, 'new_message', 'New support message', left(p_content, 100), p_conversation_id
      FROM profiles WHERE role = 'support'
      ON CONFLICT DO NOTHING;
    ELSE
      -- Support agent replied: notify the user
      INSERT INTO notifications (user_id, type, title, body, related_conversation_id)
      VALUES (v_conv.traveler_id, 'new_message', 'New support reply', left(p_content, 100), p_conversation_id);
    END IF;
  ELSE
    -- Collaboration conversation: notify the other participant
    v_recipient_id := CASE WHEN v_caller_id = v_conv.traveler_id THEN v_conv.sender_id ELSE v_conv.traveler_id END;
    IF v_recipient_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, title, body, related_conversation_id, related_message_id)
      VALUES (v_recipient_id, 'new_message', 'New message', left(p_content, 100), p_conversation_id, v_message.id);
    END IF;
  END IF;

  RETURN v_message;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.send_message(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text) TO authenticated;

-- ============================================================
-- 7. RLS Policies for support conversations
-- ============================================================

-- Users can SELECT their own support conversations; support can SELECT all support conversations
DROP POLICY IF EXISTS "conv_select_own_support" ON public.conversations;
CREATE POLICY "conv_select_own_support"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (
    context_type = 'support'
    AND (auth.uid() = traveler_id OR public.is_support())
  );

-- Only support role can UPDATE support conversations (assign/close)
DROP POLICY IF EXISTS "conv_update_support" ON public.conversations;
CREATE POLICY "conv_update_support"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (
    context_type = 'support'
    AND public.is_support()
  )
  WITH CHECK (
    context_type = 'support'
    AND public.is_support()
  );

-- Messages: users can SELECT messages in their own support conversations; support can SELECT all support messages
DROP POLICY IF EXISTS "messages_select_support" ON public.messages;
CREATE POLICY "messages_select_support"
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
      AND c.context_type = 'support'
      AND (auth.uid() = c.traveler_id OR public.is_support())
    )
  );
