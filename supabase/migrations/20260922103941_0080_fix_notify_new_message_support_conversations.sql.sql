-- Fix: notify_new_message() trigger crashes on support conversations
-- because sender_id is NULL for support conversations.
-- When a user sends a message in a support conversation:
--   conv_sender_id is NULL → recipient_id becomes NULL → notification INSERT
--   fails on NOT NULL user_id constraint.
--
-- The send_message() RPC already handles notifications for support conversations
-- (notifying all support agents when user sends, or notifying the user when
-- support replies). So the trigger should SKIP support conversations entirely
-- to avoid duplicate/broken notifications.

CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  conv_context public.conversation_context;
  conv_traveler_id uuid;
  conv_sender_id uuid;
  recipient_id uuid;
BEGIN
  SELECT context_type, traveler_id, sender_id
  INTO conv_context, conv_traveler_id, conv_sender_id
  FROM conversations WHERE id = NEW.conversation_id;

  -- Skip support conversations: send_message() RPC handles those notifications
  IF conv_context = 'support' THEN
    RETURN NEW;
  END IF;

  -- Determine the recipient (the other participant)
  IF NEW.sender_id = conv_traveler_id THEN
    recipient_id := conv_sender_id;
  ELSIF NEW.sender_id = conv_sender_id THEN
    recipient_id := conv_traveler_id;
  ELSE
    RETURN NEW; -- sender is not a participant, shouldn't happen but safety
  END IF;

  -- Guard against NULL recipient (shouldn't happen for collaboration conversations)
  IF recipient_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (user_id, type, title, body, related_conversation_id, related_message_id)
  VALUES (
    recipient_id,
    'new_message',
    'New message',
    'You have received a new message.',
    NEW.conversation_id,
    NEW.id
  );

  RETURN NEW;
END;
$function$;
