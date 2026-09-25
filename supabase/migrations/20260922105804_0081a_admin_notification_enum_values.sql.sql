-- Step 1: Add new notification_type enum values
-- Must be committed before they can be used in queries/indexes
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'admin_role_request';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'admin_verification_request';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'admin_account_deletion_request';
