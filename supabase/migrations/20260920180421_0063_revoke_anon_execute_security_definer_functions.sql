-- Revoke anon EXECUTE on trigger functions that should never be called directly
REVOKE EXECUTE ON FUNCTION public.trg_fn_commission_on_payment_hold() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_fn_reverse_commission_on_refund() FROM anon;

-- Revoke anon EXECUTE on get_marketing_completed_orders (has internal auth guard but anon should not reach it)
REVOKE EXECUTE ON FUNCTION public.get_marketing_completed_orders() FROM anon;
