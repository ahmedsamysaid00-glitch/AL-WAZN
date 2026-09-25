/*
# Fix send_message RPC: improve anti-evasion detection

## Purpose
Updates the send_message RPC to fix 4 failing anti-evasion cases:
1. Arabic WhatsApp with spaces ("وات س اب") — remove spaces then check
2. Spaced email ("name @ gmail.com") — remove spaces around @ then re-check
3. Obfuscated email ("name [at] gmail [dot] com") — simplified pattern
4. Spaced Telegram link ("t . me / username") — remove spaces around dots/slashes

## Modified Functions
- public.send_message — updated moderation regex patterns

## Security
- No changes to RLS, authentication, or membership checks
- Only moderation regex patterns are improved
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
  v_compact_nospace_nodot text;
  v_email_spaced text;
  v_telegram_spaced text;
  v_arabic_nospace text;
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
  v_normalized := p_content;
  v_normalized := translate(v_normalized, '٠١٢٣٤٥٦٧٨٩', '0123456789');
  v_normalized := translate(v_normalized, '۰۱۲۳۴۵۶۷۸۹', '0123456789');
  v_normalized := lower(v_normalized);

  -- Compact: remove spaces, hyphens, dots, underscores
  v_compact := regexp_replace(v_normalized, '[\s\-_.]+', '', 'g');

  -- Compact no brackets: also remove parentheses, brackets
  v_compact_nospace := regexp_replace(v_compact, '[()\[\]{}]+', '', 'g');

  -- For spaced email: remove spaces around @
  v_email_spaced := regexp_replace(v_normalized, '\s*@\s*', '@', 'g');

  -- For spaced telegram: remove spaces around dots and slashes
  v_telegram_spaced := regexp_replace(v_normalized, '\s*\.\s*', '.', 'g');
  v_telegram_spaced := regexp_replace(v_telegram_spaced, '\s*/\s*', '/', 'g');

  -- For Arabic WhatsApp: remove all spaces then check
  v_arabic_nospace := regexp_replace(v_normalized, '\s+', '', 'g');

  -- 5. Run moderation checks

  -- 5a. Phone number detection
  IF v_compact ~ '(?:\+|00)(?:1[0-9]{7,13}|[2-9][0-9]{7,13})' THEN
    v_category := 'phone';
    v_reason := 'Phone number detected';
  END IF;

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

  -- Spaced email: "name @ gmail.com"
  IF v_category IS NULL THEN
    IF v_email_spaced != v_normalized AND v_email_spaced ~ '[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}' THEN
      v_category := 'email';
      v_reason := 'Email address detected';
    END IF;
  END IF;

  -- Obfuscated email: "name [at] gmail [dot] com", "name (at) gmail (dot) com", "name at gmail dot com"
  IF v_category IS NULL THEN
    IF v_normalized ~ '[a-z0-9._%+\-]+\s*(\[at\]|\(at\)|\bat\b)\s*[a-z0-9.\-]+\s*(\[dot\]|\(dot\)|\bdot\b|\.)\s*[a-z]{2,}' THEN
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
    IF v_normalized ~ '[a-z0-9\-]+\.(com|net|org|io|co|me|app|dev|info|biz|tv|ly|cc|ws|us|uk|de|fr|eu|sa|ae|eg)\b'
       AND v_normalized !~ '^\d+\.\d+'
    THEN
      v_category := 'url';
      v_reason := 'External URL detected';
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
    THEN
      v_category := 'whatsapp';
      v_reason := 'WhatsApp contact detected';
    END IF;
  END IF;

  -- Arabic WhatsApp: check both with spaces removed and with optional spaces
  IF v_category IS NULL THEN
    IF v_arabic_nospace ~ 'واتساب|واتسآب|واتسأب'
       OR v_normalized ~ 'واتس\s*اب|واتس\s*أب|واتس\s*آب'
    THEN
      v_category := 'whatsapp';
      v_reason := 'WhatsApp contact detected';
    END IF;
  END IF;

  -- 5e. Telegram detection
  IF v_category IS NULL THEN
    IF v_compact ~ 'telegram' OR v_compact ~ 't\.me/' OR v_compact ~ 'telegram\.me/'
    THEN
      v_category := 'telegram';
      v_reason := 'Telegram contact detected';
    END IF;
  END IF;

  -- Spaced Telegram: "t . me / username"
  IF v_category IS NULL THEN
    IF v_telegram_spaced != v_normalized AND v_telegram_spaced ~ 't\.me/' THEN
      v_category := 'telegram';
      v_reason := 'Telegram contact detected';
    END IF;
  END IF;

  -- Arabic Telegram
  IF v_category IS NULL THEN
    IF v_normalized ~ 'تيلي?جرام|تلجرام|تليجرام' THEN
      v_category := 'telegram';
      v_reason := 'Telegram contact detected';
    END IF;
  END IF;

  -- 5f. Social media detection
  IF v_category IS NULL THEN
    IF v_compact ~ 'instagram|facebook|tiktok|snapchat|twitter|linkedin|messenger|signal|discord|wechat|skype|viber'
       OR v_compact ~ 'instagram\.com|facebook\.com|tiktok\.com|snapchat\.com|twitter\.com|linkedin\.com'
       OR v_normalized ~ 'انستجرام|انستقرام|فيسبوك|فيس\bوك|تيك\s*توك|تيكتوك|سناب\s*شات|تويتر|لينكد|مسنجر|سيجنال|ديسكورد'
    THEN
      v_category := 'social_media';
      v_reason := 'Social media contact detected';
    END IF;
  END IF;

  -- 5g. Username/handle detection (context-aware)
  IF v_category IS NULL THEN
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

    RAISE EXCEPTION 'BLOCKED:%', v_category USING ERRCODE = '45000';
  END IF;

  -- 7. Insert the allowed message
  INSERT INTO messages (conversation_id, sender_id, message_text)
  VALUES (p_conversation_id, v_caller_id, p_content)
  RETURNING * INTO v_message;

  RETURN v_message;
END;
$function$;

-- Re-grant execute to authenticated users only
REVOKE ALL ON FUNCTION public.send_message(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_message(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text) TO authenticated;
