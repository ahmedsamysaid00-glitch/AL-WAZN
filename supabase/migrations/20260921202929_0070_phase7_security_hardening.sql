/*
# Phase 7 — Security Hardening: RLS + SECURITY DEFINER Fixes

## Purpose
Fixes discovered during the Phase 7 security audit:

1. **maintenance_settings RLS gap**: The table had only a SELECT policy
   (`USING(true)` to authenticated). INSERT/UPDATE/DELETE had NO policies,
   meaning RLS denied all writes — but the `set_maintenance_enabled` RPC
   (SECURITY DEFINER) bypasses RLS, so this was functionally fine. However,
   the table is still missing explicit admin-only write policies as defense-
   in-depth. This adds them.

2. **Anon-executeable SECURITY DEFINER functions**: 7 functions were callable
   by the `anon` role. Although each has internal guards (is_admin/is_support
   checks), the principle of least privilege requires revoking anon execute.

3. **Mutable search_path on trigger functions**: 3 trigger functions
   (`update_updated_at_column`, `guard_order_financial_fields`,
   `guard_collab_financial_fields`) had no `SET search_path`. This fixes them.

## Security Changes
- Adds admin-only INSERT/UPDATE/DELETE policies on `maintenance_settings`
- Revokes EXECUTE from `anon` on 7 SECURITY DEFINER functions
- Sets `search_path = public` on 3 trigger functions
- No RLS weakening, no USING(true) on write policies, no data loss

## Functions affected
- public.get_marketing_completed_orders
- public.get_or_create_support_conversation
- public.get_support_stats
- public.is_support
- public.set_maintenance_enabled
- public.trg_fn_commission_on_payment_hold
- public.trg_fn_reverse_commission_on_refund

## Trigger functions fixed
- public.update_updated_at_column
- public.guard_order_financial_fields
- public.guard_collab_financial_fields
*/

-- ============================================================
-- 1. maintenance_settings: add admin-only write policies
-- ============================================================

DROP POLICY IF EXISTS "maintenance_insert_admin" ON maintenance_settings;
CREATE POLICY "maintenance_insert_admin"
  ON maintenance_settings FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "maintenance_update_admin" ON maintenance_settings;
CREATE POLICY "maintenance_update_admin"
  ON maintenance_settings FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "maintenance_delete_admin" ON maintenance_settings;
CREATE POLICY "maintenance_delete_admin"
  ON maintenance_settings FOR DELETE
  TO authenticated
  USING (is_admin());

-- ============================================================
-- 2. Revoke anon EXECUTE on 7 SECURITY DEFINER functions
-- ============================================================

REVOKE EXECUTE ON FUNCTION get_marketing_completed_orders FROM anon;
REVOKE EXECUTE ON FUNCTION get_or_create_support_conversation FROM anon;
REVOKE EXECUTE ON FUNCTION get_support_stats FROM anon;
REVOKE EXECUTE ON FUNCTION is_support FROM anon;
REVOKE EXECUTE ON FUNCTION set_maintenance_enabled(text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION trg_fn_commission_on_payment_hold FROM anon;
REVOKE EXECUTE ON FUNCTION trg_fn_reverse_commission_on_refund FROM anon;

-- ============================================================
-- 3. Fix mutable search_path on trigger functions
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_order_financial_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.amount <> NEW.amount THEN
    RAISE EXCEPTION 'Cannot modify order amount' USING ERRCODE = '42501';
  END IF;
  IF OLD.currency <> NEW.currency THEN
    RAISE EXCEPTION 'Cannot modify order currency' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_collab_financial_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.agreed_price <> NEW.agreed_price THEN
    RAISE EXCEPTION 'Cannot modify collaboration agreed_price' USING ERRCODE = '42501';
  END IF;
  IF OLD.currency <> NEW.currency THEN
    RAISE EXCEPTION 'Cannot modify collaboration currency' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;