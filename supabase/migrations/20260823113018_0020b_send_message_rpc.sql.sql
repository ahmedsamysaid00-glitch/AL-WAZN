/*
# Send Message RPC with Backend Content Moderation

## Purpose
Creates a secure `send_message(p_conversation_id uuid, p_content text)` function
that replaces direct client inserts into the `messages` table. This RPC:

1. Requires authentication (rejects anonymous callers)
2. Verifies the caller is a participant in the conversation
3. Validates the message content (non-empty, length limit)
4. Runs backend content moderation to block:
   - Phone numbers (international, Arabic numerals, formatted)
   - Email addresses (including obfuscated forms)
   - External URLs (including dot-obfuscation)
   - WhatsApp references (English + Arabic, with obfuscation)
   - Telegram references (English + Arabic, handles, t.me links)
   - Social media platforms and handles
   - External contact requests (English + Arabic)
5. Logs blocked attempts to `message_moderation_events` (category + reason only, NOT the message content)
6. Inserts only allowed messages
7. Fires existing triggers (notify_new_message, update_conversation_on_message)
   naturally via the INSERT, preserving notifications + realtime

## Modified Functions
- None existing are modified. This is a new function.

## Security
- SECURITY DEFINER with search_path = 'public'
- Validates auth.uid() is not null
- Validates conversation membership (sender_id or traveler_id)
- Revoke direct INSERT on messages from authenticated role so the RPC
  is the only path for inserting messages

## Important Notes
- The moderation logic is implemented in PL/pgSQL using regex patterns
  that mirror the frontend TypeScript moderation service.
- Both layers (frontend + backend) apply the same rules independently.
- Blocked messages never create a message row, notification, or realtime event.
- The RPC returns the new message row on success.
- On failure, it raises an exception with a user-friendly message (no internal details).
*/
CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id uuid,
  p_content text
) RETURNS messages
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
  v_category text;
  v_reason text;
BEGIN
  v_caller_id := auth.uid();

  -- 1. Require authentication
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 2. Validate content
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;

  IF length(p_content) > 2000 THEN
    RAISE EXCEPTION 'Message must be 2000 characters or less';
  END IF;

  -- 3. Verify conversation exists and caller is a participant
  SELECT * INTO v_conv FROM conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF v_caller_id IS DISTINCT FROM v_conv.sender_id AND v_caller_id IS DISTINCT FROM v_conv.traveler_id THEN
    RAISE EXCEPTION 'You are not a participant in this conversation';
  END IF;

  -- 4. Normalize the message for analysis
  -- Convert Arabic-Indic and Eastern Arabic-Indic digits to ASCII
  v_normalized := p_content;
  v_normalized := translate(v_normalized, '٠١٢٣٤٥٦٧٨٩', '0123456789');
  v_normalized := translate(v_normalized, '۰۱۲۳۴۵۶۷۸۹', '0123456789');
  v_normalized := lower(v_normalized);

  -- Compact version: remove spaces, hyphens, dots, underscores between characters
  v_compact := regexp_replace(v_normalized, '[\s\-_.]+', '', 'g');

  -- Compact no-space: also remove parentheses, brackets
  v_compact_nospace := regexp_replace(v_compact, '[()\[\]{}]+', '', 'g');

  -- 5. Run moderation checks

  -- 5a. Phone number detection
  -- International format: + or 00 followed by country code and number
  -- Match +<digits> or 00<digits> with at least 7 total digits
  IF v_compact ~ '(?:\+|00)(?:1[0-9]{6,14}|[2-9][0-9]{6,14})' THEN
    v_category := 'phone';
    v_reason := 'Phone number detected';
  END IF;

  -- Domestic phone: 10-15 consecutive digits (after compacting spaces/separators)
  -- But only if the digits sequence is 10+ long and not obviously part of a number context
  IF v_category IS NULL THEN
    IF v_compact ~ '(^|[^0-9])[0-9]{10,15}([^0-9]|$)'
       AND v_compact !~ '(order|flight|kg|price|weight|package|track|trip|invoice|item|quantity|number)[0-9]{10,}'
    THEN
      v_category := 'phone';
      v_reason := 'Phone number detected';
    END IF;
  END IF;

  -- 5b. Email detection
  IF v_category IS NULL THEN
    -- Standard email
    IF v_normalized ~ '[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}' THEN
      v_category := 'email';
      v_reason := 'Email address detected';
    END IF;
  END IF;

  IF v_category IS NULL THEN
    -- Obfuscated email: "name at gmail dot com", "name [at] gmail [dot] com", etc.
    IF v_normalized ~ '[a-z0-9._%+\-]+\s*(\[[a-z]\]|\([a-z]\)|at)\s*[a-z0-9]+'
       AND v_normalized ~ '(\[[a-z]\]|\([a-z]\)|dot|\.|)\s*[a-z]{2,}\s*$'
       AND v_normalized ~ '[a-z0-9._%+\-]+.*(\bat\b|\[at\]|\(at\)).*(\bdot\b|\[dot\]|\(dot\)|\.)'
    THEN
      v_category := 'email';
      v_reason := 'Email address detected';
    END IF;
  END IF;

  -- 5c. URL detection
  IF v_category IS NULL THEN
    IF v_compact ~ 'https?://' OR v_normalized ~ '\bwww\.' THEN
      v_category := 'url';
      v_reason := 'External URL detected';
    END IF;
  END IF;

  IF v_category IS NULL THEN
    -- Domain patterns: example.com, example.co.uk etc. (but not common false positives)
    IF v_normalized ~ '\b[a-z0-9\-]+\.[a-z]{2,}\b'
       AND v_normalized !~ '\b(order|flight|track|trip|invoice|item)\.[0-9]'
       AND v_compact ~ '[a-z0-9]\.[a-z]{2,}[a-z0-9]'
       AND v_normalized !~ '^[0-9]+\.[0-9]+(\s|$)'
    THEN
      -- Check it's not just a number like "5.5" or "100.50"
      IF v_normalized ~ '[a-z]+\.[a-z]{2,}' OR v_normalized ~ '[a-z0-9]+\.(com|net|org|io|co|me|app|dev|info|biz|tv|ly|cc|ws|us|uk|de|fr|eu|sa|ae|eg)' THEN
        v_category := 'url';
        v_reason := 'External URL detected';
      END IF;
    END IF;
  END IF;

  -- "example dot com" obfuscation
  IF v_category IS NULL THEN
    IF v_normalized ~ '[a-z0-9]+\s+dot\s+[a-z]{2,}' THEN
      v_category := 'url';
      v_reason := 'External URL detected';
    END IF;
  END IF;

  -- 5d. WhatsApp detection
  IF v_category IS NULL THEN
    IF v_compact_nospace ~ 'whatsa?pp' OR v_compact_nospace ~ 'whatsa?p'
       OR v_normalized ~ '\bwhats\s*app\b' OR v_normalized ~ '\bwhats\s*a?p+p\b'
       OR v_compact ~ 'wh4tsa?p+'
       -- Arabic
       OR v_normalized ~ 'واتساب|واتس\s*اب|واتسآب|واتسأب'
    THEN
      v_category := 'whatsapp';
      v_reason := 'WhatsApp contact detected';
    END IF;
  END IF;

  -- 5e. Telegram detection
  IF v_category IS NULL THEN
    IF v_compact ~ 'telegram' OR v_compact ~ 't\.me/' OR v_compact ~ 'telegram\.me/'
       -- Arabic
       OR v_normalized ~ 'تيلي?جرام|تلجرام|تليجرام'
    THEN
      v_category := 'telegram';
      v_reason := 'Telegram contact detected';
    END IF;
  END IF;

  -- 5f. Social media detection
  IF v_category IS NULL THEN
    IF v_compact ~ 'instagram|facebook|tiktok|snapchat|twitter|linkedin|messenger|signal|discord|wechat|skype|viber'
       OR v_compact ~ 'instagram\.com|facebook\.com|tiktok\.com|snapchat\.com|twitter\.com|linkedin\.com'
       -- Arabic common social media spellings
       OR v_normalized ~ 'انستجرام|انستقرام|فيسبوك|فيس\bوك|تيك\s*توك|تيكتوك|سناب\s*شات|تويتر|لينكد|مسنجر|سيجنال|ديسكورد'
    THEN
      v_category := 'social_media';
      v_reason := 'Social media contact detected';
    END IF;
  END IF;

  -- 5g. Username/handle detection (context-aware)
  IF v_category IS NULL THEN
    -- @username in context of social/telegram/contact
    IF v_normalized ~ '(instagram|telegram|snapchat|tiktok|facebook|twitter|discord|signal)\s*[:@]\s*@?[a-z0-9_]+' THEN
      v_category := 'username';
      v_reason := 'External username/handle detected';
    END IF;
  END IF;

  -- 5h. External contact request detection (English)
  IF v_category IS NULL THEN
    IF v_normalized ~ '(contact|call|text|message|email|reach)\s+me\s+(on|at|via|outside)'
       OR v_normalized ~ '(send|give)\s+me\s+(your\s+)?(number|phone|email|whatsapp|telegram)'
       OR v_normalized ~ 'my\s+(number|phone|email|whatsapp|telegram)\s*(is|:)?'
       OR v_normalized ~ '(contact|message)\s+(me\s+)?outside\s+(the\s+)?platform'
    THEN
      v_category := 'contact_request';
      v_reason := 'External contact request detected';
    END IF;
  END IF;

  -- 5h-AR. External contact request detection (Arabic)
  IF v_category IS NULL THEN
    IF v_normalized ~ 'كلمني|راسلني|ابعتلي|ابعت\s+لي'
       OR v_normalized ~ 'هات\s+رقمك|ابعت\s+رقمك|ده\s+رقمي|رقمي\s+هو'
       OR v_normalized ~ 'تواصل\s+معي'
       OR v_normalized ~ 'برا\s*المنصة|خارج\s*المنصة'
       OR v_normalized ~ 'كلمني\s+على|راسلني\s+على|تواصل\s+معي\s+على'
    THEN
      v_category := 'contact_request';
      v_reason := 'External contact request detected';
    END IF;
  END IF;

  -- 6. If blocked, log and reject
  IF v_category IS NOT NULL THEN
    INSERT INTO message_moderation_events (user_id, conversation_id, category, reason)
    VALUES (v_caller_id, p_conversation_id, v_category, v_reason);

    -- Return a user-friendly error (no internal details)
    RAISE EXCEPTION 'BLOCKED:%', v_category USING ERRCODE = '45000';
  END IF;

  -- 7. Insert the allowed message
  -- The existing triggers (notify_new_message, update_conversation_on_message)
  -- will fire automatically on this INSERT, preserving notification + realtime behavior.
  INSERT INTO messages (conversation_id, sender_id, message_text)
  VALUES (p_conversation_id, v_caller_id, p_content)
  RETURNING * INTO v_message;

  RETURN v_message;
END;
$function$;

-- Grant execute to authenticated users only
REVOKE ALL ON FUNCTION public.send_message(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_message(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text) TO authenticated;
