/*
# Marketing System — RPCs, Triggers, and Schema Adjustments

## Schema Adjustments
- Add referral_code to marketing_settings
- Remove UNIQUE from marketing_referrals.referral_code (multiple users share one code)
- Add unique index on (referral_code, referred_user_id) WHERE referred_user_id IS NOT NULL
- Allow negative commission_amount for reversal entries

## Helper Functions
- get_marketer_id() — returns the single marketer's profile id
- is_marketer() — checks if caller is the marketer

## RPCs
- claim_referral(p_referral_code text) — links a registered user to a referral
- update_marketing_settings(...) — admin updates commission settings
- approve_commission(p_commission_id uuid) — admin approves
- pay_commission(p_commission_id uuid) — admin marks paid + creates payout record
- reverse_commission(p_commission_id uuid, p_reason text) — admin reverses

## Triggers
- trg_fn_commission_on_payment_hold — creates commission when payment → held
- trg_fn_reverse_commission_on_refund — reverses commission when payment → refunded
*/

-- ============================================================
-- Schema Adjustments
-- ============================================================

ALTER TABLE marketing_settings ADD COLUMN IF NOT EXISTS referral_code text;

ALTER TABLE marketing_referrals DROP CONSTRAINT IF EXISTS marketing_referrals_referral_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_referral_code_user
  ON marketing_referrals(referral_code, referred_user_id)
  WHERE referred_user_id IS NOT NULL;

ALTER TABLE marketing_commissions DROP CONSTRAINT IF EXISTS marketing_commissions_commission_amount_check;

-- Generate referral code if not set
UPDATE marketing_settings
SET referral_code = 'MKT-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6))
WHERE referral_code IS NULL;

-- ============================================================
-- Helper Functions
-- ============================================================

CREATE OR REPLACE FUNCTION get_marketer_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text;
  v_id uuid;
BEGIN
  SELECT marketer_email INTO v_email FROM platform_settings LIMIT 1;
  IF v_email IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM profiles WHERE email = v_email AND role = 'marketing' LIMIT 1;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION is_marketer()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN auth.uid() IS NOT NULL AND auth.uid() = get_marketer_id();
END;
$$;

-- ============================================================
-- claim_referral — links a registered user to a referral code
-- ============================================================

CREATE OR REPLACE FUNCTION claim_referral(p_referral_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid;
  v_settings marketing_settings%ROWTYPE;
  v_marketer_id uuid;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  IF p_referral_code IS NULL OR trim(p_referral_code) = '' THEN
    RETURN false;
  END IF;

  SELECT * INTO v_settings FROM marketing_settings LIMIT 1;
  IF NOT FOUND OR v_settings.attribution_enabled = false THEN
    RETURN false;
  END IF;

  v_marketer_id := get_marketer_id();
  IF v_marketer_id IS NULL THEN RETURN false; END IF;

  -- Code must match the marketer's referral code
  IF v_settings.referral_code IS NULL OR v_settings.referral_code <> trim(p_referral_code) THEN
    RETURN false;
  END IF;

  -- Don't allow self-referral
  IF v_marketer_id = v_caller THEN RETURN false; END IF;

  -- Don't allow if caller is already referred
  IF EXISTS (SELECT 1 FROM marketing_referrals WHERE referred_user_id = v_caller) THEN
    RETURN false;
  END IF;

  -- Check attribution window
  IF v_settings.attribution_window_days > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM marketing_referrals
      WHERE referral_code = v_settings.referral_code
        AND referred_user_id IS NULL
        AND created_at >= now() - (v_settings.attribution_window_days || ' days')::interval
    ) THEN
      -- No pending attribution within window — create a fresh one
      INSERT INTO marketing_referrals (marketer_id, referral_code, referred_user_id, status, registered_at)
      VALUES (v_marketer_id, v_settings.referral_code, v_caller, 'registered', now());
      RETURN true;
    END IF;
  END IF;

  -- Link the oldest unattributed referral to this user
  UPDATE marketing_referrals
  SET referred_user_id = v_caller, registered_at = now(), status = 'registered', updated_at = now()
  WHERE id = (
    SELECT id FROM marketing_referrals
    WHERE referral_code = v_settings.referral_code
      AND referred_user_id IS NULL
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  );

  IF NOT FOUND THEN
    -- No pending attribution record — create a new one
    INSERT INTO marketing_referrals (marketer_id, referral_code, referred_user_id, status, registered_at)
    VALUES (v_marketer_id, v_settings.referral_code, v_caller, 'registered', now());
  END IF;

  RETURN true;
END;
$$;

-- ============================================================
-- update_marketing_settings — admin only
-- ============================================================

CREATE OR REPLACE FUNCTION update_marketing_settings(
  p_commission_rate numeric,
  p_commission_base commission_base,
  p_attribution_enabled boolean,
  p_attribution_window_days integer
)
RETURNS marketing_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result marketing_settings%ROWTYPE;
  v_old_rate numeric;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can update marketing settings';
  END IF;

  IF p_commission_rate IS NULL OR p_commission_rate < 0 OR p_commission_rate > 100 THEN
    RAISE EXCEPTION 'Commission rate must be between 0 and 100';
  END IF;

  IF p_attribution_window_days IS NULL OR p_attribution_window_days <= 0 THEN
    RAISE EXCEPTION 'Attribution window must be a positive number of days';
  END IF;

  SELECT commission_rate INTO v_old_rate FROM marketing_settings LIMIT 1;

  UPDATE marketing_settings
  SET commission_rate = p_commission_rate,
      commission_base = p_commission_base,
      attribution_enabled = p_attribution_enabled,
      attribution_window_days = p_attribution_window_days,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = (SELECT id FROM marketing_settings LIMIT 1)
  RETURNING * INTO v_result;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (
    auth.uid(), COALESCE(get_marketer_id(), auth.uid()),
    'marketing_settings_changed', 'marketing_settings', v_result.id,
    'Rate: ' || v_old_rate || ' -> ' || p_commission_rate || ', base: ' || p_commission_base
  );

  RETURN v_result;
END;
$$;

-- ============================================================
-- approve_commission — admin only
-- ============================================================

CREATE OR REPLACE FUNCTION approve_commission(p_commission_id uuid)
RETURNS marketing_commissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result marketing_commissions%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve commissions';
  END IF;

  UPDATE marketing_commissions
  SET status = 'approved', approved_at = now(), approved_by = auth.uid()
  WHERE id = p_commission_id AND status = 'pending'
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission not found or not in pending status';
  END IF;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (auth.uid(), v_result.marketer_id, 'commission_approved', 'marketing_commission', p_commission_id);

  INSERT INTO notifications (user_id, type, title, body)
  VALUES (v_result.marketer_id, 'commission_approved', 'Commission Approved',
          'A commission of ' || v_result.commission_amount || ' ' || v_result.currency || ' has been approved.');

  RETURN v_result;
END;
$$;

-- ============================================================
-- pay_commission — admin only, creates payout record
-- ============================================================

CREATE OR REPLACE FUNCTION pay_commission(p_commission_id uuid)
RETURNS marketing_commissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result marketing_commissions%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can pay commissions';
  END IF;

  UPDATE marketing_commissions
  SET status = 'paid', paid_at = now(), paid_by = auth.uid()
  WHERE id = p_commission_id AND status = 'approved'
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission not found or not in approved status';
  END IF;

  INSERT INTO marketing_payouts (marketer_id, amount, currency, status, commission_ids, completed_at, completed_by)
  VALUES (v_result.marketer_id, v_result.commission_amount, v_result.currency, 'completed',
          ARRAY[p_commission_id], now(), auth.uid());

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
  VALUES (auth.uid(), v_result.marketer_id, 'commission_paid', 'marketing_commission', p_commission_id);

  INSERT INTO notifications (user_id, type, title, body)
  VALUES (v_result.marketer_id, 'commission_paid', 'Commission Paid',
          'A commission of ' || v_result.commission_amount || ' ' || v_result.currency || ' has been paid.');

  RETURN v_result;
END;
$$;

-- ============================================================
-- reverse_commission — admin only
-- ============================================================

CREATE OR REPLACE FUNCTION reverse_commission(p_commission_id uuid, p_reason text)
RETURNS marketing_commissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result marketing_commissions%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can reverse commissions';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to reverse a commission';
  END IF;

  UPDATE marketing_commissions
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
      cancellation_reason = p_reason
  WHERE id = p_commission_id AND status IN ('pending', 'approved')
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission not found or not in a reversible status (pending/approved)';
  END IF;

  INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
  VALUES (auth.uid(), v_result.marketer_id, 'commission_reversed', 'marketing_commission', p_commission_id, p_reason);

  INSERT INTO notifications (user_id, type, title, body)
  VALUES (v_result.marketer_id, 'commission_reversed', 'Commission Reversed',
          'A commission of ' || v_result.commission_amount || ' ' || v_result.currency || ' has been reversed. Reason: ' || p_reason);

  RETURN v_result;
END;
$$;

-- ============================================================
-- Trigger: create commission when payment → held
-- ============================================================

CREATE OR REPLACE FUNCTION trg_fn_commission_on_payment_hold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_referral marketing_referrals%ROWTYPE;
  v_settings marketing_settings%ROWTYPE;
  v_marketer_id uuid;
  v_base_value numeric;
  v_commission_amount numeric;
BEGIN
  -- Only fire when payment transitions TO 'held' from a non-held state
  IF OLD.status = 'held' OR NEW.status <> 'held' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_marketer_id := get_marketer_id();
    IF v_marketer_id IS NULL THEN RETURN NEW; END IF;

    SELECT * INTO v_settings FROM marketing_settings LIMIT 1;
    IF NOT FOUND OR v_settings.attribution_enabled = false THEN
      RETURN NEW;
    END IF;

    SELECT * INTO v_order FROM orders WHERE id = NEW.order_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    -- Check if the payer was referred by the marketer
    SELECT * INTO v_referral FROM marketing_referrals
    WHERE referred_user_id = NEW.payer_id AND marketer_id = v_marketer_id
    LIMIT 1;
    IF NOT FOUND THEN RETURN NEW; END IF;

    -- Calculate commission base
    IF v_settings.commission_base = 'platform_fee' THEN
      v_base_value := NEW.platform_fee;
    ELSE
      v_base_value := v_order.total_amount;
    END IF;

    v_commission_amount := ROUND(v_base_value * v_settings.commission_rate / 100, 2);

    -- Insert commission (unique index prevents duplicates)
    INSERT INTO marketing_commissions (
      marketer_id, referred_user_id, referral_id, order_id, payment_id,
      gross_order_amount, platform_fee_amount, commission_base_value,
      commission_rate, commission_amount, commission_base_type, currency, status
    ) VALUES (
      v_marketer_id, NEW.payer_id, v_referral.id, NEW.order_id, NEW.id,
      v_order.total_amount, NEW.platform_fee, v_base_value,
      v_settings.commission_rate, v_commission_amount, v_settings.commission_base, NEW.currency, 'pending'
    )
    ON CONFLICT (marketer_id, order_id) WHERE status IN ('pending', 'approved', 'paid')
    DO NOTHING;

    -- Update referral to converted
    UPDATE marketing_referrals
    SET status = 'converted', converted_at = now(), updated_at = now()
    WHERE id = v_referral.id AND status = 'registered';

    -- Notify marketer
    INSERT INTO notifications (user_id, type, title, body)
    VALUES (v_marketer_id, 'commission_created', 'Commission Earned',
            'A new commission of ' || v_commission_amount || ' ' || NEW.currency || ' has been created.');

    -- Audit log
    INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id)
    VALUES (NEW.payer_id, v_marketer_id, 'commission_created', 'marketing_commission', NEW.order_id);

  EXCEPTION WHEN OTHERS THEN
    -- Never fail the payment hold due to commission issues
    RAISE NOTICE 'Commission creation skipped: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- ============================================================
-- Trigger: reverse commission when payment → refunded
-- ============================================================

CREATE OR REPLACE FUNCTION trg_fn_reverse_commission_on_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_commission marketing_commissions%ROWTYPE;
BEGIN
  -- Only fire when payment transitions TO 'refunded' from a non-refunded state
  IF OLD.status = 'refunded' OR NEW.status <> 'refunded' THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Reverse pending/approved commissions
    SELECT * INTO v_commission FROM marketing_commissions
    WHERE order_id = NEW.order_id AND status IN ('pending', 'approved')
    LIMIT 1;

    IF FOUND THEN
      UPDATE marketing_commissions
      SET status = 'reversed', cancelled_at = now(),
          cancellation_reason = 'Payment refunded'
      WHERE id = v_commission.id;

      INSERT INTO notifications (user_id, type, title, body)
      VALUES (v_commission.marketer_id, 'commission_reversed', 'Commission Reversed',
              'A commission of ' || v_commission.commission_amount || ' ' || v_commission.currency || ' has been reversed due to a refund.');

      INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
      VALUES (COALESCE(auth.uid(), v_commission.marketer_id), v_commission.marketer_id,
              'commission_reversed', 'marketing_commission', v_commission.id,
              'Reversed due to payment refund');
    END IF;

    -- For already-paid commissions, create a reversal entry
    SELECT * INTO v_commission FROM marketing_commissions
    WHERE order_id = NEW.order_id AND status = 'paid'
    LIMIT 1;

    IF FOUND THEN
      INSERT INTO marketing_commissions (
        marketer_id, referred_user_id, referral_id, order_id, payment_id,
        gross_order_amount, platform_fee_amount, commission_base_value,
        commission_rate, commission_amount, commission_base_type, currency, status,
        cancellation_reason, metadata
      ) VALUES (
        v_commission.marketer_id, v_commission.referred_user_id, v_commission.referral_id,
        NEW.order_id, NEW.id, 0, 0, 0, v_commission.commission_rate,
        -v_commission.commission_amount, v_commission.commission_base_type, v_commission.currency,
        'reversed', 'Reversal of paid commission for refunded order',
        jsonb_build_object('reversal_of', v_commission.id)
      );

      INSERT INTO notifications (user_id, type, title, body)
      VALUES (v_commission.marketer_id, 'commission_reversed', 'Commission Reversed',
              'A paid commission of ' || v_commission.commission_amount || ' ' || v_commission.currency || ' has been reversed due to a refund.');

      INSERT INTO audit_logs (admin_id, target_user_id, action, entity_type, entity_id, reason)
      VALUES (COALESCE(auth.uid(), v_commission.marketer_id), v_commission.marketer_id,
              'commission_reversed', 'marketing_commission', v_commission.id,
              'Reversal of paid commission for refunded order');
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- Never fail the refund due to commission reversal issues
    RAISE NOTICE 'Commission reversal skipped: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- ============================================================
-- Create triggers on payments table
-- ============================================================

DROP TRIGGER IF EXISTS trg_commission_on_hold ON payments;
CREATE TRIGGER trg_commission_on_hold
  AFTER UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_commission_on_payment_hold();

DROP TRIGGER IF EXISTS trg_reverse_commission_on_refund ON payments;
CREATE TRIGGER trg_reverse_commission_on_refund
  AFTER UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_reverse_commission_on_refund();

-- ============================================================
-- Grants
-- ============================================================

GRANT EXECUTE ON FUNCTION claim_referral(text) TO authenticated;
GRANT EXECUTE ON FUNCTION update_marketing_settings(numeric, commission_base, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_commission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pay_commission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION reverse_commission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_marketer_id() TO authenticated;
GRANT EXECUTE ON FUNCTION is_marketer() TO authenticated;

REVOKE EXECUTE ON FUNCTION claim_referral(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION update_marketing_settings(numeric, commission_base, boolean, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION approve_commission(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION pay_commission(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION reverse_commission(uuid, text) FROM anon, public;
