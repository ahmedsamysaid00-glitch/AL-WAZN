-- Fix: The previous migration (0028) added tables to a publication named "realtime"
-- but Supabase's managed realtime server reads from "supabase_realtime".
-- This is why INSERT on verification_requests and DELETE on profiles never reached open pages.
-- This migration adds all application tables to the correct publication.

DO $$
DECLARE
  v_tables text[] := ARRAY[
    'profiles',
    'trips',
    'sender_listings',
    'collaborations',
    'orders',
    'shipment_tracking_events',
    'shipment_receipt_photos',
    'delivery_qr_tokens',
    'conversations',
    'messages',
    'notifications',
    'payments',
    'refunds',
    'wallet_accounts',
    'financial_ledger_entries',
    'platform_fee_settings',
    'verification_requests',
    'user_requests',
    'notification_preferences',
    'audit_logs',
    'message_moderation_events'
  ];
  v_table text;
  v_pubname text := 'supabase_realtime';
BEGIN
  -- Ensure the supabase_realtime publication exists
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = v_pubname) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = v_pubname AND schemaname = 'public' AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.%I', v_pubname, v_table);
    END IF;
  END LOOP;
END $$;

-- Set REPLICA IDENTITY FULL on profiles so DELETE events include all columns.
-- The AdminUsers page subscribes to profiles without a filter, so default (d)
-- would work, but other pages may filter on profiles columns.
-- FULL is safe here — profiles is a small table and we need DELETE payloads
-- to carry enough data for any future column-based filters.
ALTER TABLE public.profiles REPLICA IDENTITY FULL;

-- Also set FULL on platform_fee_settings and audit_logs for consistency
-- (these may be subscribed to by admin pages with potential filters).
ALTER TABLE public.platform_fee_settings REPLICA IDENTITY FULL;
ALTER TABLE public.audit_logs REPLICA IDENTITY FULL;
ALTER TABLE public.message_moderation_events REPLICA IDENTITY FULL;
ALTER TABLE public.notification_preferences REPLICA IDENTITY FULL;
