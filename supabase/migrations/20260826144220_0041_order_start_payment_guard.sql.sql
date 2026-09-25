/*
# Order Start Guard: Require Verified Payment Before Trip Start

## Summary
Modifies the `guard_order_status_transition` trigger function to add a server-side
check: an order CANNOT transition from `confirmed` to `in_transit` unless the
payment has a `held` status (i.e., receipt was approved by admin).

This is the critical security enforcement: even if the frontend is manipulated,
the database will reject the transition if the payment hasn't been verified.

## Changes
- Modified `guard_order_status_transition()` trigger function
- Added payment verification check in the `confirmed -> in_transit` transition
- The check verifies a payment exists with status = 'held' for the order

## Security
- Server-side enforcement, cannot be bypassed by frontend manipulation
- Payment must be in 'held' status (admin-verified receipt)
- Existing shipment receipt photo requirement is preserved
*/

CREATE OR REPLACE FUNCTION guard_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF NEW.status = OLD.status THEN
RETURN NEW;
END IF;

-- pending -> awaiting_payment (traveler accepts)
IF OLD.status = 'pending' AND NEW.status = 'awaiting_payment' THEN
IF NEW.traveler_confirmed_at IS NULL THEN
NEW.traveler_confirmed_at := now();
END IF;
RETURN NEW;
END IF;

-- pending -> cancelled (cancel before acceptance)
IF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
NEW.cancelled_at := now();
RETURN NEW;
END IF;

-- awaiting_payment -> confirmed (payment held — via RPC only)
IF OLD.status = 'awaiting_payment' AND NEW.status = 'confirmed' THEN
RETURN NEW;
END IF;

-- awaiting_payment -> cancelled (cancel before payment)
IF OLD.status = 'awaiting_payment' AND NEW.status = 'cancelled' THEN
NEW.cancelled_at := now();
RETURN NEW;
END IF;

-- confirmed -> in_transit: REQUIRE verified payment AND shipment receipt photo
IF OLD.status = 'confirmed' AND NEW.status = 'in_transit' THEN
-- Payment must be verified (held status = admin approved the receipt)
IF NOT EXISTS (
  SELECT 1 FROM payments
  WHERE order_id = NEW.id AND status = 'held'
) THEN
RAISE EXCEPTION 'Payment must be verified before starting the trip.';
END IF;
-- Shipment receipt photo must exist
IF NOT EXISTS (SELECT 1 FROM shipment_receipt_photos WHERE order_id = NEW.id) THEN
RAISE EXCEPTION 'You must photograph the shipment before continuing.';
END IF;
RETURN NEW;
END IF;

-- confirmed -> cancelled
IF OLD.status = 'confirmed' AND NEW.status = 'cancelled' THEN
NEW.cancelled_at := now();
RETURN NEW;
END IF;

-- in_transit -> delivered
IF OLD.status = 'in_transit' AND NEW.status = 'delivered' THEN
NEW.delivered_at := now();
RETURN NEW;
END IF;

-- in_transit -> cancelled
IF OLD.status = 'in_transit' AND NEW.status = 'cancelled' THEN
NEW.cancelled_at := now();
RETURN NEW;
END IF;

-- delivered -> received
IF OLD.status = 'delivered' AND NEW.status = 'received' THEN
NEW.received_at := now();
IF NEW.sender_confirmed_at IS NULL THEN
NEW.sender_confirmed_at := now();
END IF;
RETURN NEW;
END IF;

-- received -> completed
IF OLD.status = 'received' AND NEW.status = 'completed' THEN
NEW.completed_at := now();
RETURN NEW;
END IF;

RAISE EXCEPTION 'Invalid order status transition: % to %', OLD.status, NEW.status;
END;
$$;
