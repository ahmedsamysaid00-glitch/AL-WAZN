/**
 * Central message moderation service.
 *
 * This is the single source of truth for frontend content moderation.
 * The backend `send_message` RPC implements equivalent rules in PL/pgSQL.
 * Both layers apply the same checks independently — the frontend gives
 * instant user feedback, the backend is the authoritative enforcement.
 */

export type ModerationCategory =
  | 'phone'
  | 'email'
  | 'url'
  | 'whatsapp'
  | 'telegram'
  | 'social_media'
  | 'username'
  | 'contact_request';

export interface ModerationResult {
  allowed: boolean;
  category?: ModerationCategory;
  reason?: string;
}

/**
 * Normalize Arabic-Indic and Eastern Arabic-Indic digits to ASCII,
 * lowercase, and collapse repeated whitespace.
 */
function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Lowercase + digit-normalize the input for analysis. */
function normalize(text: string): string {
  return normalizeDigits(text).toLowerCase();
}

/** Remove all whitespace, hyphens, dots, underscores for compact pattern matching. */
function compact(text: string): string {
  return text.replace(/[\s\-_.]+/g, '');
}

/** Like compact but also strips brackets/parentheses. */
function compactNoBrackets(text: string): string {
  return compact(text).replace(/[()[\]{}]+/g, '');
}

// ---- Phone number detection ----

/**
 * Detect phone numbers that look like international or domestic phone numbers.
 * Avoids false positives on short numbers like "Order 12345", "5 kg", "2026".
 */
function detectPhone(normalized: string, cmp: string): boolean {
  // International format: +<countrycode><number> or 00<countrycode><number>
  // Must have at least 8 digits total (country code 1-3 digits + subscriber 7-12)
  if (/(?:\+|00)(?:1[0-9]{7,13}|[2-9][0-9]{7,13})/.test(cmp)) {
    return true;
  }

  // Domestic: 10-15 consecutive digits, but not preceded by words like "order", "flight", etc.
  // We check the compact string for digit sequences of 10+ length.
  const digitMatch = cmp.match(/(^|[^0-9])([0-9]{10,15})([^0-9]|$)/);
  if (digitMatch) {
    // Exclude if it's clearly part of a non-phone context
    const before = cmp.slice(0, digitMatch.index);
    const contextWords = /(order|flight|invoice|track|tracking|trip|item|quantity|number|kg|price|weight|package|packages|id|ref|reference)$/;
    if (!contextWords.test(before)) {
      return true;
    }
  }

  // Formatted domestic: detect patterns like "010 123 456 78" (after normalization the spaces
  // are gone in cmp, but in the normalized string we can check for phone-like groupings)
  // Check the normalized string for phone-number-like patterns with separators
  const phoneGrouped = normalized.match(/(?:\+|00)?[\d][\d\s.-]{8,18}[\d]/);
  if (phoneGrouped) {
    // Extract digits only and check length
    const digitsOnly = phoneGrouped[0].replace(/[\s.-]/g, '');
    if (digitsOnly.length >= 10 && digitsOnly.length <= 15) {
      // Check it's not a decimal number like "100.50 dollars"
      if (!/(\d+\.\d+\s*(dollars?|usd|eur|gbp|kg|km|lbs?|pounds?))/i.test(normalized)) {
        return true;
      }
    }
  }

  return false;
}

// ---- Email detection ----

function detectEmail(normalized: string): boolean {
  // Standard email
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(normalized)) {
    return true;
  }

  // Spaced email: "name @ gmail.com" — remove spaces around @ then re-check
  const spacedFixed = normalized.replace(/\s*@\s*/g, '@');
  if (spacedFixed !== normalized && /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(spacedFixed)) {
    return true;
  }

  // Obfuscated: "name at gmail dot com", "name [at] gmail [dot] com", "name (at) gmail (dot) com"
  // Also handles "name [at] gmail [dot] com" with full [at] and [dot]
  if (/[a-z0-9._%+-]+\s*(\[at\]|\(at\)|\bat\b)\s*[a-z0-9.-]+\s*(\[dot\]|\(dot\)|\bdot\b|\.)\s*[a-z]{2,}/i.test(normalized)) {
    return true;
  }

  return false;
}

// ---- URL detection ----

function detectUrl(normalized: string, cmp: string): boolean {
  if (/https?:\/\//.test(cmp) || /\bwww\./.test(normalized)) {
    return true;
  }

  // Domain pattern: something.tld (e.g. example.com, example.co.uk)
  // Exclude pure decimal numbers like "5.5" or "100.50"
  const domainMatch = normalized.match(/\b([a-z0-9-]+)\.([a-z]{2,})\b/i);
  if (domainMatch) {
    const tld = domainMatch[2];
    const commonTlds = ['com', 'net', 'org', 'io', 'co', 'me', 'app', 'dev', 'info', 'biz', 'tv', 'ly', 'cc', 'ws', 'us', 'uk', 'de', 'fr', 'eu', 'sa', 'ae', 'eg'];
    if (commonTlds.includes(tld) || tld.length >= 2) {
      // Make sure it's not just a decimal number
      if (!/^\d+\.\d+/.test(domainMatch[0])) {
        return true;
      }
    }
  }

  // "example dot com" obfuscation
  if (/[a-z0-9]+\s+dot\s+[a-z]{2,}/i.test(normalized)) {
    return true;
  }

  return false;
}

// ---- WhatsApp detection ----

function detectWhatsApp(normalized: string, cmp: string, cmpNb: string): boolean {
  if (/whatsa?pp/i.test(cmpNb) || /whats\s*a?p+p/i.test(normalized)) {
    return true;
  }
  if (/wh4tsa?p+/i.test(cmp)) {
    return true;
  }
  // Arabic — also catch spaced variants like "وات س اب" by removing spaces then checking
  const arabicNoSpace = normalized.replace(/\s+/g, '');
  if (/واتساب|واتسآب|واتسأب/.test(arabicNoSpace)) {
    return true;
  }
  // Also check normalized with optional spaces between Arabic chars
  if (/واتس\s*اب|واتس\s*أب|واتس\s*آب/.test(normalized)) {
    return true;
  }
  return false;
}

// ---- Telegram detection ----

function detectTelegram(normalized: string, cmp: string): boolean {
  if (/telegram/i.test(cmp) || /t\.me\//.test(cmp) || /telegram\.me\//.test(cmp)) {
    return true;
  }
  // Spaced obfuscation: "t . me / username" — remove spaces around dots and slashes
  const spacedFixed = normalized.replace(/\s*\.\s*/g, '.').replace(/\s*\/\s*/g, '/');
  if (spacedFixed !== normalized && /t\.me\//.test(spacedFixed)) {
    return true;
  }
  // Arabic
  if (/تيلي?جرام|تلجرام|تليجرام/.test(normalized)) {
    return true;
  }
  return false;
}

// ---- Social media detection ----

const SOCIAL_PATTERNS = [
  /instagram/i, /facebook/i, /tiktok/i, /snapchat/i, /twitter/i, /linkedin/i,
  /messenger/i, /signal/i, /discord/i, /wechat/i, /skype/i, /viber/i,
];

const SOCIAL_ARABIC = /انستجرام|انستقرام|فيسبوك|فيس\bوك|تيك\s*توك|تيكتوك|سناب\s*شات|تويتر|لينكد|مسنجر|سيجنال|ديسكورد/;

function detectSocialMedia(normalized: string, cmp: string): boolean {
  if (SOCIAL_PATTERNS.some((p) => p.test(cmp))) {
    return true;
  }
  if (SOCIAL_ARABIC.test(normalized)) {
    return true;
  }
  // Social media URLs
  if (/instagram\.com|facebook\.com|tiktok\.com|snapchat\.com|twitter\.com|linkedin\.com/i.test(cmp)) {
    return true;
  }
  return false;
}

// ---- Username/handle detection (context-aware) ----

function detectUsername(normalized: string): boolean {
  // @username in context of social/telegram/contact
  if (/(instagram|telegram|snapchat|tiktok|facebook|twitter|discord|signal)\s*[:@]\s*@?[a-z0-9_]+/i.test(normalized)) {
    return true;
  }
  return false;
}

// ---- External contact request detection ----

const CONTACT_REQUEST_EN = [
  /(?:contact|call|text|message|email|reach)\s+me\s+(?:on|at|via|outside)/i,
  /(?:send|give)\s+me\s+(?:your\s+)?(?:number|phone|email|whatsapp|telegram)/i,
  /my\s+(?:number|phone|email|whatsapp|telegram)\s*(?:is|:)?/i,
  /(?:contact|message)\s+(?:me\s+)?outside\s+(?:the\s+)?platform/i,
];

const CONTACT_REQUEST_AR = [
  /كلمني|راسلني|ابعتلي|ابعت\s+لي/,
  /هات\s+رقمك|ابعت\s+رقمك|ده\s+رقمي|رقمي\s+هو/,
  /تواصل\s+معي/,
  /برا\s*المنصة|خارج\s*المنصة/,
  /كلمني\s+على|راسلني\s+على|تواصل\s+معي\s+على/,
];

function detectContactRequest(normalized: string): boolean {
  if (CONTACT_REQUEST_EN.some((p) => p.test(normalized))) {
    return true;
  }
  if (CONTACT_REQUEST_AR.some((p) => p.test(normalized))) {
    return true;
  }
  return false;
}

/**
 * Run all moderation checks on a message.
 * Returns { allowed: true } if the message is safe to send,
 * or { allowed: false, category, reason } if it should be blocked.
 */
export function moderateMessage(content: string): ModerationResult {
  if (!content || content.trim().length === 0) {
    return { allowed: true };
  }

  const normalized = normalize(content);
  const cmp = compact(normalized);
  const cmpNb = compactNoBrackets(normalized);

  // Order matters: check most specific patterns first

  if (detectPhone(normalized, cmp)) {
    return { allowed: false, category: 'phone', reason: 'Phone number detected' };
  }

  if (detectEmail(normalized)) {
    return { allowed: false, category: 'email', reason: 'Email address detected' };
  }

  if (detectUrl(normalized, cmp)) {
    return { allowed: false, category: 'url', reason: 'External URL detected' };
  }

  if (detectWhatsApp(normalized, cmp, cmpNb)) {
    return { allowed: false, category: 'whatsapp', reason: 'WhatsApp contact detected' };
  }

  if (detectTelegram(normalized, cmp)) {
    return { allowed: false, category: 'telegram', reason: 'Telegram contact detected' };
  }

  if (detectSocialMedia(normalized, cmp)) {
    return { allowed: false, category: 'social_media', reason: 'Social media contact detected' };
  }

  if (detectUsername(normalized)) {
    return { allowed: false, category: 'username', reason: 'External username/handle detected' };
  }

  if (detectContactRequest(normalized)) {
    return { allowed: false, category: 'contact_request', reason: 'External contact request detected' };
  }

  return { allowed: true };
}
