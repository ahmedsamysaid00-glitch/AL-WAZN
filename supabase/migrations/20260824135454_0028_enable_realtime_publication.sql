-- Enable realtime publication for all application tables
-- This is required for Supabase Realtime postgres_changes to work.
-- RLS remains enforced — users only receive events for rows they can read.

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
BEGIN
  -- Ensure the realtime publication exists
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'realtime') THEN
    CREATE PUBLICATION realtime;
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'realtime' AND schemaname = 'public' AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END $$;

-- Set replica identity to FULL for tables that need DELETE events
-- (DELETE payloads only include primary key columns by default;
--  with FULL, all columns are included so filters work on DELETE)
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'messages',
    'notifications',
    'orders',
    'collaborations',
    'payments',
    'refunds',
    'trips',
    'sender_listings',
    'shipment_tracking_events',
    'shipment_receipt_photos',
    'delivery_qr_tokens',
    'wallet_accounts',
    'financial_ledger_entries',
    'verification_requests',
    'user_requests',
    'conversations'
  ];
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', v_table);
  END LOOP;
END $$;
