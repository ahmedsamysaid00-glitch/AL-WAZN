-- Add audit_action enum value for admin provisioning
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'admin_provisioned';
