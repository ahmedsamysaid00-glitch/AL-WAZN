import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { UserLayout } from './UserLayout';
import { LoadingState } from '@/components/ui/States';
import { CreditCard, ArrowLeft, DollarSign, Receipt, Calendar, Loader2, FileText, Wallet } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { PaymentWithDetails, PaymentStatus, Refund, PaymentReceipt, Payout } from '@/types/database';
import { usePaymentReceivingNumber } from '@/hooks/usePlatformSettings';

export function PaymentDetailPage() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const { profile } = useAuth();
  const { receivingNumber } = usePaymentReceivingNumber();
  const { id } = useParams();
  const [payment, setPayment] = useState<PaymentWithDetails | null>(null);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [payout, setPayout] = useState<Payout | null>(null);
  const [, setReceiptUrl] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const fetchPayment = useCallback(async () => {
    if (!id) { setNotFound(true); setLoading(false); return; }
    setNotFound(false);
    const { data, error: err } = await supabase
      .from('payments')
      .select(`
        *,
        orders!inner(order_number, status, total_amount, currency, agreed_weight_kg)
      `)
      .eq('id', id)
      .maybeSingle();
    if (err || !data) { setNotFound(true); setLoading(false); return; }
    setPayment(data as PaymentWithDetails);

    const [refundRes, receiptRes, payoutRes] = await Promise.all([
      supabase.from('refunds').select('*').eq('payment_id', id).order('created_at', { ascending: false }),
      supabase.from('payment_receipts').select('*').eq('payment_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('payouts').select('*').eq('payment_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    setRefunds((refundRes.data as Refund[]) ?? []);
    setReceipt(receiptRes.data as PaymentReceipt | null);
    setPayout(payoutRes.data as Payout | null);

    setLoading(false);
  }, [id]);

  useEffect(() => { fetchPayment(); }, [fetchPayment]);

  useRealtimeRefresh(
    [
      { table: 'payments', filter: `id=eq.${id ?? ''}` },
      { table: 'refunds', filter: `payment_id=eq.${id ?? ''}` },
      { table: 'payment_receipts', filter: `payment_id=eq.${id ?? ''}` },
      { table: 'payouts', filter: `payment_id=eq.${id ?? ''}` },
    ],
    () => fetchPayment(),
    !!id,
  );

  const handleRequestRefund = async () => {
    if (!payment || !refundAmount) return;
    const amount = parseFloat(refundAmount);
    if (isNaN(amount) || amount <= 0) { setActionError(t('admin.refundAmountInvalid')); return; }
    const totalRefunded = refunds
      .filter(r => ['requested', 'approved', 'processing', 'completed'].includes(r.status))
      .reduce((sum, r) => sum + r.amount, 0);
    const refundable = payment.amount - totalRefunded;
    if (amount > refundable) { setActionError(t('admin.refundAmountExceeds')); return; }
    setActionLoading(true);
    const { error: err } = await supabase.rpc('request_refund', {
      p_payment_id: payment.id,
      p_amount: parseFloat(refundAmount),
      p_reason: refundReason || null,
    });
    setActionLoading(false);
    if (err) { setActionError(t('payments.refundFailed')); return; }
    setShowRefundForm(false);
    setRefundAmount('');
    setRefundReason('');
    setActionSuccess(t('payments.refundRequested'));
    fetchPayment();
  };

  if (loading) return (
    <UserLayout><div className="max-w-3xl"><div className="flex justify-center py-12"><LoadingState /></div></div></UserLayout>
  );
  if (notFound || !payment) return (
    <UserLayout>
      <div className="max-w-3xl">
        <div className="card p-8 text-center">
          <p className="text-slate-600 dark:text-slate-400">{t('payments.empty')}</p>
          <Link to="/dashboard/payments" className="btn-secondary btn-sm mt-4">{t('common.back')}</Link>
        </div>
      </div>
    </UserLayout>
  );

  const isPayer = payment.payer_id === profile?.id;
  const canRequestRefund = isPayer && ['held', 'paid', 'partially_refunded'].includes(payment.status);

  return (
    <UserLayout>
      <div className="max-w-3xl space-y-6">
        <Link to="/dashboard/payments" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className={`h-4 w-4 ${arrow}`} /> {t('common.back')}
        </Link>

        <div className="card p-6 space-y-6">
          {actionError && (
            <div className="alert-error">{actionError}</div>
          )}
          {actionSuccess && (
            <div className="alert-success">{actionSuccess}</div>
          )}
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('payments.detailTitle')}</h1>
            <PaymentStatusBadge status={payment.status} t={t} />
          </div>

          {/* Manual payment info */}
          {payment.payment_method === 'manual' && (
            <div className="rounded-lg border border-primary-200 bg-primary-50 p-4 space-y-2">
              <div className="flex items-start gap-3">
                <CreditCard className="h-5 w-5 text-primary-600 shrink-0" />
                <p className="text-sm text-primary-800">{t('payments.manualPaymentNote')}</p>
              </div>
              {payment.status === 'pending' && (
                <div className="flex items-center gap-2 rounded-lg bg-white dark:bg-slate-800 p-3">
                  <div>
                    <p className="text-xs font-medium text-primary-600 dark:text-primary-400">{t('order.action.transferTo')}</p>
                    <p className="text-lg font-bold tracking-wider text-primary-900 dark:text-primary-100" dir="ltr">{receivingNumber}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <InfoItem icon={<DollarSign />} label={t('payments.amount')} value={`${payment.amount} ${payment.currency}`} />
            <InfoItem icon={<Receipt />} label={t('payments.platformFee')} value={`${payment.platform_fee} ${payment.currency}`} />
            <InfoItem icon={<DollarSign />} label={t('payments.netAmount')} value={`${payment.net_amount} ${payment.currency}`} />
            <InfoItem icon={<CreditCard />} label={t('payments.method')} value={t(`payments.method.${payment.payment_method}` as TranslationKey)} />
            {payment.provider && <InfoItem icon={<CreditCard />} label={t('payments.provider')} value={payment.provider} />}
            {payment.provider_payment_id && <InfoItem icon={<CreditCard />} label={t('payments.providerId')} value={payment.provider_payment_id} />}
            <InfoItem icon={<Calendar />} label={t('payments.createdAt')} value={new Date(payment.created_at).toLocaleString()} />
            {payment.paid_at && <InfoItem icon={<Calendar />} label={t('payments.paidAt')} value={new Date(payment.paid_at).toLocaleString()} />}
          </div>

          {payment.failure_reason && (
            <div className="rounded-lg border border-error-200 bg-error-50 p-4">
              <p className="text-sm font-medium text-error-800">{t('payments.failureReason')}</p>
              <p className="mt-1 text-sm text-error-700">{payment.failure_reason}</p>
            </div>
          )}

          {canRequestRefund && !showRefundForm && (
            <button onClick={() => setShowRefundForm(true)} className="btn-secondary btn-sm">
              {t('payments.requestRefund')}
            </button>
          )}

          {showRefundForm && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('payments.requestRefund')}</h3>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('payments.refundAmount')}</label>
                <input type="number" step="0.01" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} className="input" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('payments.refundReason')}</label>
                <textarea value={refundReason} onChange={(e) => setRefundReason(e.target.value)} className="input" rows={2} />
              </div>
              <div className="flex gap-2">
                <button onClick={handleRequestRefund} disabled={actionLoading || !refundAmount} className="btn-primary btn-sm">
                  {t('common.confirm')}
                </button>
                <button onClick={() => setShowRefundForm(false)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
              </div>
            </div>
          )}

          {/* Receipt status */}
          {receipt && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('order.action.uploadReceiptTitle')}</p>
              </div>
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-slate-400" />
                <div className="flex-1">
                  <p className="text-sm text-slate-600 dark:text-slate-400">{receipt.file_name}</p>
                  <p className="text-xs text-slate-400">{new Date(receipt.created_at).toLocaleString()}</p>
                </div>
                <ReceiptStatusBadge status={receipt.status} t={t} />
              </div>
              {receipt.rejection_reason && (
                <p className="text-sm text-error-600 pl-7">{receipt.rejection_reason}</p>
              )}
              {/* View receipt for sender who uploaded it */}
              {isPayer && (
                <ViewReceiptButton storagePath={receipt.storage_path} onUrl={setReceiptUrl} t={t} />
              )}
            </div>
          )}

          {/* Payout status (traveler view) */}
          {payout && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('order.action.payoutStatus')}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-slate-500">{t('order.action.grossAmount')}</p>
                  <p className="font-medium text-slate-700 dark:text-slate-300">{payout.gross_amount} {payout.currency}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">{t('order.action.platformFee')}</p>
                  <p className="font-medium text-slate-700 dark:text-slate-300">{payout.platform_fee} {payout.currency}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">{t('order.action.netAmount')}</p>
                  <p className="font-medium text-success-600">{payout.net_amount} {payout.currency}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">{t('order.action.payoutMethod')}</p>
                  <p className="font-medium text-slate-700 dark:text-slate-300">{t(`order.action.payoutMethodType.${payout.payout_method}` as TranslationKey)}</p>
                </div>
              </div>
              {payout.rejection_reason && (
                <p className="text-sm text-error-600">{payout.rejection_reason}</p>
              )}
            </div>
          )}

          {refunds.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">{t('refunds.title')}</h3>
              <div className="space-y-2">
                {refunds.map((r) => (
                  <div key={r.id} className="rounded-lg border border-slate-100 dark:border-slate-700 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">{r.amount} {payment.currency}</span>
                      <RefundStatusBadge status={r.status} t={t} />
                    </div>
                    {r.reason && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{r.reason}</p>}
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{new Date(r.created_at).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </UserLayout>
  );
}

function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-slate-400 dark:text-slate-500">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <p className="break-anywhere text-sm font-semibold text-slate-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}

function PaymentStatusBadge({ status, t }: { status: PaymentStatus; t: (k: TranslationKey) => string }) {
  const map: Record<PaymentStatus, string> = {
    pending: 'badge-warning', processing: 'badge-accent', held: 'badge-accent', paid: 'badge-success',
    released: 'badge-success', failed: 'badge-error', cancelled: 'badge-neutral', refunded: 'badge-primary', partially_refunded: 'badge-primary',
  };
  const labelKey: Record<PaymentStatus, TranslationKey> = {
    pending: 'payments.status.pending', processing: 'payments.status.processing', held: 'payments.status.held',
    paid: 'payments.status.paid', released: 'payments.status.released',
    failed: 'payments.status.failed', cancelled: 'payments.status.cancelled', refunded: 'payments.status.refunded',
    partially_refunded: 'payments.status.partially_refunded',
  };
  return <span className={map[status]}>{t(labelKey[status])}</span>;
}

function ReceiptStatusBadge({ status, t }: { status: PaymentReceipt['status']; t: (k: TranslationKey) => string }) {
  const map: Record<string, string> = {
    pending_verification: 'badge-warning',
    approved: 'badge-success',
    rejected: 'badge-error',
  };
  const labelKey: Record<string, TranslationKey> = {
    pending_verification: 'admin.receiptStatus.pending_verification',
    approved: 'admin.receiptStatus.approved',
    rejected: 'admin.receiptStatus.rejected',
  };
  return <span className={map[status] ?? 'badge-neutral'}>{t(labelKey[status] ?? 'admin.receiptStatus.pending_verification')}</span>;
}

function ViewReceiptButton({ storagePath, onUrl, t }: { storagePath: string; onUrl: (url: string) => void; t: (k: TranslationKey) => string }) {
  const [loading, setLoading] = useState(false);
  const handleClick = async () => {
    setLoading(true);
    const { data } = await supabase.storage.from('payment-receipts').createSignedUrl(storagePath, 300);
    setLoading(false);
    if (data?.signedUrl) {
      onUrl(data.signedUrl);
      window.open(data.signedUrl, '_blank');
    }
  };
  return (
    <button onClick={handleClick} disabled={loading} className="btn-secondary btn-sm">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
      {t('admin.receiptView')}
    </button>
  );
}

function RefundStatusBadge({ status, t }: { status: Refund['status']; t: (k: TranslationKey) => string }) {
  const map: Record<string, string> = {
    requested: 'badge-warning', approved: 'badge-accent', processing: 'badge-accent',
    completed: 'badge-success', failed: 'badge-error', cancelled: 'badge-neutral',
  };
  const labelKey: Record<string, TranslationKey> = {
    requested: 'refunds.status.requested', approved: 'refunds.status.approved', processing: 'refunds.status.processing',
    completed: 'refunds.status.completed', failed: 'refunds.status.failed', cancelled: 'refunds.status.cancelled',
  };
  return <span className={map[status]}>{t(labelKey[status])}</span>;
}
