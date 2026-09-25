/*
# Message Moderation Events Table

## Purpose
Creates a logging table to track blocked message moderation attempts.
This allows administrators to monitor how many messages are being blocked,
which categories are most common, and which users are repeatedly attempting
to share external contact information.

## New Tables
- `message_moderation_events`
  - `id` (uuid, PK) — unique event ID
  - `user_id` (uuid, NOT NULL) — the user who attempted to send a blocked message
  - `conversation_id` (uuid, NOT NULL) — the conversation the message was attempted in
  - `category` (text, NOT NULL) — the moderation category that triggered the block
  - `reason` (text, NOT NULL) — a short human-readable reason for the block
  - `created_at` (timestamptz, default now()) — when the attempt occurred

## Security
- RLS enabled on `message_moderation_events`
- Users can only see their own moderation events (SELECT)
- Only the send_message RPC (SECURITY DEFINER) can INSERT — no direct user INSERT
- Admins can see all moderation events
- No INSERT/UPDATE/DELETE policies for authenticated users — all writes go through the RPC

## Important Notes
- The actual blocked message content is NOT stored — only the category and reason.
- The `send_message` RPC inserts into this table when it blocks a message.
*/
CREATE TABLE IF NOT EXISTS message_moderation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  category text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE message_moderation_events ENABLE ROW LEVEL SECURITY;

-- Users can see their own moderation events
DROP POLICY IF EXISTS "mod_event_select_own" ON message_moderation_events;
CREATE POLICY "mod_event_select_own"
ON message_moderation_events FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Admins can see all moderation events
DROP POLICY IF EXISTS "mod_event_select_admin" ON message_moderation_events;
CREATE POLICY "mod_event_select_admin"
ON message_moderation_events FOR SELECT
TO authenticated
USING (public.is_admin());

-- No INSERT/UPDATE/DELETE policies for direct user access.
-- All inserts are done by the send_message RPC (SECURITY DEFINER).

CREATE INDEX IF NOT EXISTS idx_mod_events_user_id ON message_moderation_events(user_id);
CREATE INDEX IF NOT EXISTS idx_mod_events_created_at ON message_moderation_events(created_at DESC);
