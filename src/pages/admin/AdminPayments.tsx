import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { useLanguage } from '@/i18n/useLanguage';
import { AdminLayout } from './AdminLayout';
import { ErrorState, EmptyState } from '@/components/ui/States';
import { Pagination } from '@/components/ui/Pagination';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import { SkeletonTable } from '@/components/ui/Skeleton';
import {
  CreditCard, Search, ChevronLeft, ChevronRight, DollarSign, TrendingUp,
  Check, Wallet, Upload, XCircle, Eye, ArrowUp, ArrowDown, X,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type {
  PaymentWithDetails, PaymentStatus, PaymentReceipt, PayoutWithDetails, PayoutStatus,
} from '@/types/database';

const PAGE_SIZE = 10;

type AdminTab = 'payments' | 'receipts' | 'payouts';
type SortState = { col: string; asc: boolean };

export function AdminPayments() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const [tab, setTab] = useState<AdminTab>('payments');

  // Payments state
  const [payments, setPayments] = useState<PaymentWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [paymentsSort, setPaymentsSort] = useState<SortState>({ col: 'created_at', asc: false });
  const [stats, setStats] = useState({ volume: 0, fees: 0, pending: 0, held: 0, released: 0, successful: 0, failed: 0, refunded: 0 });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'completePayment' | 'approveReceipt' | 'approvePayout' | 'markPayoutPaid'; id: string; label?: string } | null>(null);
  const { toast, showToast, dismissToast } = useToast();

  // Receipts state
  const [receipts, setReceipts] = useState<(PaymentReceipt & { payments?: { amount: number; currency: string; payer_id: string; payee_id: string; status: PaymentStatus }; orders?: { order_number: string; traveler_id: string }; uploader_profile?: { full_name: string | null } })[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [receiptsError, setReceiptsError] = useState(false);
  const [receiptsPage, setReceiptsPage] = useState(0);
  const [receiptsTotal, setReceiptsTotal] = useState(0);
  const [receiptsSearch, setReceiptsSearch] = useState('');
  const [receiptsStatusFilter, setReceiptsStatusFilter] = useState('all');
  const [receiptUrlLoading, setReceiptUrlLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState<string | null>(null);

  // Payouts state
  const [payouts, setPayouts] = useState<PayoutWithDetails[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);
  const [payoutsError, setPayoutsError] = useState(false);
  const [payoutsPage, setPayoutsPage] = useState(0);
  const [payoutsTotal, setPayoutsTotal] = useState(0);
  const [payoutsSearch, setPayoutsSearch] = useState('');
  const [payoutsStatusFilter, setPayoutsStatusFilter] = useState('all');
  const [payoutRejectBox, setPayoutRejectBox] = useState<string | null>(null);
  const [payoutRejectReason, setPayoutRejectReason] = useState('');

  // Pending counts for stats/badges (fetched separately from paginated data)
  const [pendingReceiptsCount, setPendingReceiptsCount] = useState(0);
  const [pendingPayoutsCount, setPendingPayoutsCount] = useState(0);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(false);
    let query = supabase.from('payments').select('*, orders(order_number, status, total_amount, currency), payer_profile:profiles!payments_payer_id_fkey(full_name), payee_profile:profiles!payments_payee_id_fkey(full_name)', { count: 'exact' });
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (search) query = query.or(`provider_payment_id.ilike.%${search}%`);
    query = query.order(paymentsSort.col, { ascending: paymentsSort.asc });
    if (paymentsSort.col !== 'created_at') {
      query = query.order('created_at', { ascending: false });
    }
    query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, error: err, count } = await query;
    if (err) { setError(true); setLoading(false); return; }
    setPayments((data as PaymentWithDetails[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [statusFilter, search, page, paymentsSort]);

  const fetchStats = useCallback(async () => {
    const { data, error: statsErr } = await supabase.rpc('get_payment_stats');
    if (!statsErr && data) setStats(data as typeof stats);
  }, []);

  const fetchReceipts = useCallback(async () => {
    setReceiptsLoading(true);
    setReceiptsError(false);
    let query = supabase
      .from('payment_receipts')
      .select(`
        *,
        payments(amount, currency, payer_id, payee_id, status),
        orders(order_number, traveler_id),
        uploader_profile:profiles!payment_receipts_uploader_id_fkey(full_name)
      `, { count: 'exact' });
    if (receiptsStatusFilter !== 'all') query = query.eq('status', receiptsStatusFilter);
    if (receiptsSearch) query = query.ilike('file_name', `%${receiptsSearch}%`);
    query = query.order('created_at', { ascending: false })
      .range(receiptsPage * PAGE_SIZE, (receiptsPage + 1) * PAGE_SIZE - 1);
    const { data, error: rErr, count } = await query;
    if (rErr) {
      setReceiptsError(true);
      setReceiptsLoading(false);
      return;
    }
    setReceipts((data as typeof receipts) ?? []);
    setReceiptsTotal(count ?? 0);
    setReceiptsLoading(false);
  }, [receiptsPage, receiptsStatusFilter, receiptsSearch]);

  const fetchPayouts = useCallback(async () => {
    setPayoutsLoading(true);
    setPayoutsError(false);
    let query = supabase
      .from('payouts')
      .select(`
        *,
        orders(order_number, status),
        traveler_profile:profiles!payouts_traveler_id_fkey(full_name)
      `, { count: 'exact' });
    if (payoutsStatusFilter !== 'all') query = query.eq('status', payoutsStatusFilter);
    if (payoutsSearch) query = query.ilike('payout_identifier', `%${payoutsSearch}%`);
    query = query.order('created_at', { ascending: false })
      .range(payoutsPage * PAGE_SIZE, (payoutsPage + 1) * PAGE_SIZE - 1);
    const { data, error: pErr, count } = await query;
    if (pErr) {
      setPayoutsError(true);
      setPayoutsLoading(false);
      return;
    }
    setPayouts((data as PayoutWithDetails[]) ?? []);
    setPayoutsTotal(count ?? 0);
    setPayoutsLoading(false);
  }, [payoutsPage, payoutsStatusFilter, payoutsSearch]);

  const fetchPendingCounts = useCallback(async () => {
    const { count: rCount } = await supabase
      .from('payment_receipts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending_verification');
    setPendingReceiptsCount(rCount ?? 0);

    const { count: pCount } = await supabase
      .from('payouts')
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending', 'approved', 'processing']);
    setPendingPayoutsCount(pCount ?? 0);
  }, []);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchPendingCounts(); }, [fetchPendingCounts]);
  useEffect(() => { if (tab === 'receipts') fetchReceipts(); }, [tab, fetchReceipts]);
  useEffect(() => { if (tab === 'payouts') fetchPayouts(); }, [tab, fetchPayouts]);

  useRealtimeRefresh(
    [{ table: 'payments' }, { table: 'payment_receipts' }, { table: 'payouts' }, { table: 'refunds' }, { table: 'wallet_accounts' }, { table: 'financial_ledger_entries' }],
    () => {
      fetchPayments();
      fetchStats();
      fetchPendingCounts();
      if (tab === 'receipts') fetchReceipts();
      if (tab === 'payouts') fetchPayouts();
    },
  );

  const handleCompletePayment = async () => {
    if (!confirmAction || confirmAction.type !== 'completePayment') return;
    const paymentId = confirmAction.id;
    setActionLoading(paymentId);
    const { error: rpcErr } = await supabase.rpc('complete_payment', { p_payment_id: paymentId });
    setActionLoading(null);
    if (rpcErr) { showToast('error', t('admin.markPaidFailed')); return; }
    showToast('success', t('admin.markPaidSuccess'));
    setConfirmAction(null);
    fetchPayments(); fetchStats();
  };

  const handleApproveReceipt = async () => {
    if (!confirmAction || confirmAction.type !== 'approveReceipt') return;
    const receiptId = confirmAction.id;
    setActionLoading(receiptId);
    const { error: rpcErr } = await supabase.rpc('verify_payment_receipt', { p_receipt_id: receiptId });
    setActionLoading(null);
    if (rpcErr) { showToast('error', t('admin.receiptApproveFailed')); return; }
    showToast('success', t('admin.receiptApproveSuccess'));
    setConfirmAction(null);
    fetchReceipts();
  };

  const handleRejectReceipt = async (receiptId: string) => {
    if (!rejectReason.trim()) return;
    setActionLoading(receiptId);
    const { error: rpcErr } = await supabase.rpc('reject_payment_receipt', {
      p_receipt_id: receiptId,
      p_rejection_reason: rejectReason.trim(),
    });
    setActionLoading(null);
    if (rpcErr) { showToast('error', t('admin.receiptRejectFailed')); return; }
    showToast('success', t('admin.receiptRejectSuccess'));
    setShowRejectBox(null);
    setRejectReason('');
    fetchReceipts();
  };

  const handleViewReceipt = async (storagePath: string) => {
    setReceiptUrlLoading(true);
    const { data } = await supabase.storage.from('payment-receipts').createSignedUrl(storagePath, 300);
    setReceiptUrlLoading(false);
    if (data?.signedUrl) {
      window.open(data.signedUrl, '_blank');
    }
  };

  const handleApprovePayout = async () => {
    if (!confirmAction || confirmAction.type !== 'approvePayout') return;
    const payoutId = confirmAction.id;
    setActionLoading(payoutId);
    const { error: rpcErr } = await supabase.rpc('approve_payout', { p_payout_id: payoutId });
    setActionLoading(null);
    if (rpcErr) { showToast('error', t('admin.payoutApproveFailed')); return; }
    showToast('success', t('admin.payoutApproveSuccess'));
    setConfirmAction(null);
    fetchPayouts();
  };

  const handleMarkPayoutPaid = async () => {
    if (!confirmAction || confirmAction.type !== 'markPayoutPaid') return;
    const payoutId = confirmAction.id;
    setActionLoading(payoutId);
    const { error: rpcErr } = await supabase.rpc('complete_payout', { p_payout_id: payoutId });
    setActionLoading(null);
    if (rpcErr) { showToast('error', t('admin.payoutMarkPaidFailed')); return; }
    showToast('success', t('admin.payoutMarkPaidSuccess'));
    setConfirmAction(null);
    fetchPayouts();
  };

  const handleRejectPayout = async (payoutId: string) => {
    if (!payoutRejectReason.trim()) return;
    setActionLoading(payoutId);
    const { error: rpcErr } = await supabase.rpc('reject_payout', {
      p_payout_id: payoutId,
      p_rejection_reason: payoutRejectReason.trim(),
    });
    setActionLoading(null);
    if (rpcErr) { showToast('error', t('admin.payoutRejectFailed')); return; }
    showToast('success', t('admin.payoutRejectSuccess'));
    setPayoutRejectBox(null);
    setPayoutRejectReason('');
    fetchPayouts();
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const togglePaymentsSort = (col: string) => {
    setPaymentsSort((prev) => {
      if (prev.col === col) return { col, asc: !prev.asc };
      return { col, asc: true };
    });
    setPage(0);
  };

  const sortIcon = (col: string) => {
    if (paymentsSort.col !== col) return null;
    return paymentsSort.asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const receiptFiltersActive = receiptsSearch !== '' || receiptsStatusFilter !== 'all';
  const payoutFiltersActive = payoutsSearch !== '' || payoutsStatusFilter !== 'all';
  const paymentFiltersActive = search !== '' || statusFilter !== 'all';

  const clearReceiptFilters = () => {
    setReceiptsSearch('');
    setReceiptsStatusFilter('all');
    setReceiptsPage(0);
  };

  const clearPayoutFilters = () => {
    setPayoutsSearch('');
    setPayoutsStatusFilter('all');
    setPayoutsPage(0);
  };

  const clearPaymentFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setPage(0);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('admin.paymentsTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('admin.paymentsSubtitle')}</p>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<DollarSign />} label={t('admin.totalPaymentVolume')} value={`${stats.volume.toFixed(2)}`} color="primary" />
          <StatCard icon={<TrendingUp />} label={t('admin.totalPlatformFees')} value={`${stats.fees.toFixed(2)}`} color="success" />
          <StatCard icon={<Upload />} label={t('admin.receiptVerification')} value={String(pendingReceiptsCount)} color="warning" />
          <StatCard icon={<Wallet />} label={t('admin.pendingPayouts')} value={String(pendingPayoutsCount)} color="accent" />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
          <TabButton active={tab === 'payments'} onClick={() => setTab('payments')} label={t('admin.paymentsTitle')} />
          <TabButton active={tab === 'receipts'} onClick={() => setTab('receipts')} label={t('admin.receiptsTitle')} badge={pendingReceiptsCount} />
          <TabButton active={tab === 'payouts'} onClick={() => setTab('payouts')} label={t('admin.payoutsTitle')} badge={pendingPayoutsCount} />
        </div>

        {/* ===== PAYMENTS TAB ===== */}
        {tab === 'payments' && (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  placeholder={t('common.search')}
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  className="input pl-10"
                />
              </div>
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} className="input sm:w-48">
                <option value="all">{t('admin.allPaymentStatuses')}</option>
                <option value="pending">{t('payments.status.pending')}</option>
                <option value="processing">{t('payments.status.processing')}</option>
                <option value="held">{t('payments.status.held')}</option>
                <option value="paid">{t('payments.status.paid')}</option>
                <option value="released">{t('payments.status.released')}</option>
                <option value="failed">{t('payments.status.failed')}</option>
                <option value="cancelled">{t('payments.status.cancelled')}</option>
                <option value="refunded">{t('payments.status.refunded')}</option>
                <option value="partially_refunded">{t('payments.status.partially_refunded')}</option>
              </select>
              {paymentFiltersActive && (
                <button onClick={clearPaymentFilters} className="btn-secondary btn-sm shrink-0">
                  <X className="h-4 w-4" /> {t('admin.clearFilters')}
                </button>
              )}
            </div>

            {loading ? (
              <SkeletonTable rows={5} columns={9} />
            ) : error ? (
              <div className="card"><ErrorState message={t('admin.failedLoadPayments')} onRetry={fetchPayments} retryLabel={t('common.retry')} /></div>
            ) : payments.length === 0 ? (
              <div className="card"><EmptyState icon={<CreditCard className="h-8 w-8" />} title={paymentFiltersActive ? t('admin.noPaymentsMatched') : t('admin.paymentsEmpty')} /></div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="card hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-700 text-left text-xs font-medium text-slate-500 dark:text-slate-400">
                        <th className="px-4 py-3">{t('admin.paymentOrder')}</th>
                        <th className="px-4 py-3">{t('admin.paymentPayer')}</th>
                        <th className="px-4 py-3">{t('admin.paymentPayee')}</th>
                        <SortableTh label={t('admin.paymentAmount')} col="amount" sortState={paymentsSort} onSort={togglePaymentsSort} icon={sortIcon('amount')} />
                        <th className="px-4 py-3">{t('admin.paymentFee')}</th>
                        <th className="px-4 py-3">{t('admin.paymentNet')}</th>
                        <SortableTh label={t('admin.paymentStatus')} col="status" sortState={paymentsSort} onSort={togglePaymentsSort} icon={sortIcon('status')} />
                        <SortableTh label={t('admin.paymentDate')} col="created_at" sortState={paymentsSort} onSort={togglePaymentsSort} icon={sortIcon('created_at')} />
                        <th className="px-4 py-3">{t('common.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800/50 dark:bg-black/60">
                          <td className="px-4 py-3 font-medium text-slate-900 dark:text-white break-all">{p.orders?.order_number ?? '—'}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.payer_profile?.full_name ?? t('admin.deletedUser')}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.payee_profile?.full_name ?? t('admin.deletedUser')}</td>
                          <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{p.amount} {p.currency}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.platform_fee} {p.currency}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.net_amount} {p.currency}</td>
                          <td className="px-4 py-3"><PaymentStatusBadge status={p.status} t={t} /></td>
                          <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{new Date(p.created_at).toLocaleDateString()}</td>
                          <td className="px-4 py-3">
                            {(p.status === 'pending' || p.status === 'processing') && (
                              <button onClick={() => setConfirmAction({ type: 'completePayment', id: p.id, label: p.orders?.order_number })} disabled={actionLoading === p.id} className="btn-primary btn-sm">
                                <Check className="h-4 w-4" /> {t('admin.markPaid')}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="space-y-3 md:hidden">
                  {payments.map((p) => (
                    <div key={p.id} className="card p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-900 dark:text-white break-all">{p.orders?.order_number ?? '—'}</span>
                        <PaymentStatusBadge status={p.status} t={t} />
                      </div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-500 dark:text-slate-400">{t('admin.paymentPayer')}</span>
                          <span className="text-slate-700 dark:text-slate-300">{p.payer_profile?.full_name ?? t('admin.deletedUser')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 dark:text-slate-400">{t('admin.paymentPayee')}</span>
                          <span className="text-slate-700 dark:text-slate-300">{p.payee_profile?.full_name ?? t('admin.deletedUser')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 dark:text-slate-400">{t('admin.paymentAmount')}</span>
                          <span className="text-slate-700 dark:text-slate-300">{p.amount} {p.currency}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 dark:text-slate-400">{t('admin.paymentFee')}</span>
                          <span className="text-slate-600 dark:text-slate-400">{p.platform_fee} {p.currency}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 dark:text-slate-400">{t('admin.paymentNet')}</span>
                          <span className="text-slate-600 dark:text-slate-400">{p.net_amount} {p.currency}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 dark:text-slate-400">{t('admin.paymentDate')}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{new Date(p.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      {(p.status === 'pending' || p.status === 'processing') && (
                        <button onClick={() => setConfirmAction({ type: 'completePayment', id: p.id, label: p.orders?.order_number })} disabled={actionLoading === p.id} className="btn-primary btn-sm w-full">
                          <Check className="h-4 w-4" /> {t('admin.markPaid')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.page')} {page + 1} {t('common.of')} {totalPages}</p>
                    <div className="flex gap-2">
                      <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="btn-secondary btn-sm disabled:opacity-50">
                        <ChevronLeft className={`h-4 w-4 ${arrow}`} /> {t('common.previous')}
                      </button>
                      <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="btn-secondary btn-sm disabled:opacity-50">
                        {t('common.next')} <ChevronRight className={`h-4 w-4 ${arrow}`} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ===== RECEIPTS TAB ===== */}
        {tab === 'receipts' && (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  placeholder={t('admin.receiptSearch')}
                  value={receiptsSearch}
                  onChange={(e) => { setReceiptsSearch(e.target.value); setReceiptsPage(0); }}
                  className="input pl-10"
                />
              </div>
              <select value={receiptsStatusFilter} onChange={(e) => { setReceiptsStatusFilter(e.target.value); setReceiptsPage(0); }} className="input sm:w-48">
                <option value="all">{t('admin.allReceiptStatuses')}</option>
                <option value="pending_verification">{t('admin.receiptStatus.pending_verification')}</option>
                <option value="approved">{t('admin.receiptStatus.approved')}</option>
                <option value="rejected">{t('admin.receiptStatus.rejected')}</option>
              </select>
              {receiptFiltersActive && (
                <button onClick={clearReceiptFilters} className="btn-secondary btn-sm shrink-0">
                  <X className="h-4 w-4" /> {t('admin.clearFilters')}
                </button>
              )}
            </div>

            {receiptsLoading ? (
              <SkeletonTable rows={5} columns={6} />
            ) : receiptsError ? (
              <div className="card"><ErrorState message={t('admin.failedLoadReceipts')} onRetry={fetchReceipts} retryLabel={t('common.retry')} /></div>
            ) : receipts.length === 0 ? (
              <div className="card"><EmptyState icon={<Upload className="h-8 w-8" />} title={receiptFiltersActive ? t('admin.noReceiptsMatched') : t('admin.noReceipts')} /></div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="card hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-700 text-left text-xs font-medium text-slate-500 dark:text-slate-400">
                      <th className="px-4 py-3">{t('admin.receiptOrder')}</th>
                      <th className="px-4 py-3">{t('admin.receiptSender')}</th>
                      <th className="px-4 py-3">{t('admin.receiptAmount')}</th>
                      <th className="px-4 py-3">{t('admin.receiptStatus')}</th>
                      <th className="px-4 py-3">{t('admin.receiptUploadedAt')}</th>
                      <th className="px-4 py-3">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800/50 dark:bg-black/60">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white break-all">{r.orders?.order_number ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{r.uploader_profile?.full_name ?? t('admin.deletedUser')}</td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.payments?.amount ?? '—'} {r.payments?.currency ?? ''}</td>
                        <td className="px-4 py-3"><ReceiptStatusBadge status={r.status} t={t} /></td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{new Date(r.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => handleViewReceipt(r.storage_path)}
                              disabled={receiptUrlLoading}
                              className="btn-secondary btn-sm"
                            >
                              <Eye className="h-4 w-4" /> {t('admin.receiptView')}
                            </button>
                            {r.status === 'pending_verification' && (
                              <>
                                <button
                                  onClick={() => setConfirmAction({ type: 'approveReceipt', id: r.id, label: r.orders?.order_number })}
                                  disabled={actionLoading === r.id}
                                  className="btn-primary btn-sm bg-success-600 hover:bg-success-700"
                                >
                                  <Check className="h-4 w-4" /> {t('admin.receiptApprove')}
                                </button>
                                {showRejectBox === r.id ? (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <input
                                      type="text"
                                      value={rejectReason}
                                      onChange={(e) => setRejectReason(e.target.value)}
                                      placeholder={t('admin.receiptRejectReasonPrompt')}
                                      className="input btn-sm w-full sm:w-48"
                                    />
                                    <button
                                      onClick={() => handleRejectReceipt(r.id)}
                                      disabled={!rejectReason.trim() || actionLoading === r.id}
                                      className="btn-primary btn-sm bg-error-600 hover:bg-error-700"
                                    >
                                      {t('admin.receiptReject')}
                                    </button>
                                    <button onClick={() => { setShowRejectBox(null); setRejectReason(''); }} className="btn-secondary btn-sm">
                                      {t('common.cancel')}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setShowRejectBox(r.id)}
                                    disabled={actionLoading === r.id}
                                    className="btn-secondary btn-sm text-error-600"
                                  >
                                    <XCircle className="h-4 w-4" /> {t('admin.receiptReject')}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

                {/* Mobile cards */}
                <div className="space-y-3 md:hidden">
                  {receipts.map((r) => (
                    <div key={r.id} className="card p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-900 dark:text-white break-all">{r.orders?.order_number ?? '—'}</span>
                        <ReceiptStatusBadge status={r.status} t={t} />
                      </div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-500 dark:text-slate-400">{t('admin.receiptSender')}</span>
                          <span className="text-slate-700 dark:text-slate-300">{r.uploader_profile?.full_name ?? t('admin.deletedUser')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 dark:text-slate-400">{t('admin.receiptAmount')}</span>
                          <span className="text-slate-700 dark:text-slate-300">{r.payments?.amount ?? '—'} {r.payments?.currency ?? ''}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 dark:text-slate-400">{t('admin.receiptUploadedAt')}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{new Date(r.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => handleViewReceipt(r.storage_path)} disabled={receiptUrlLoading} className="btn-secondary btn-sm flex-1">
                          <Eye className="h-4 w-4" /> {t('admin.receiptView')}
                        </button>
                        {r.status === 'pending_verification' && (
                          <>
                            <button
                              onClick={() => setConfirmAction({ type: 'approveReceipt', id: r.id, label: r.orders?.order_number })}
                              disabled={actionLoading === r.id}
                              className="btn-primary btn-sm bg-success-600 hover:bg-success-700 flex-1"
                            >
                              <Check className="h-4 w-4" /> {t('admin.receiptApprove')}
                            </button>
                            {showRejectBox === r.id ? (
                              <div className="w-full space-y-2">
                                <input
                                  type="text"
                                  value={rejectReason}
                                  onChange={(e) => setRejectReason(e.target.value)}
                                  placeholder={t('admin.receiptRejectReasonPrompt')}
                                  className="input btn-sm w-full"
                                />
                                <div className="flex gap-2">
                                  <button onClick={() => handleRejectReceipt(r.id)} disabled={!rejectReason.trim() || actionLoading === r.id} className="btn-primary btn-sm bg-error-600 hover:bg-error-700 flex-1">
                                    {t('admin.receiptReject')}
                                  </button>
                                  <button onClick={() => { setShowRejectBox(null); setRejectReason(''); }} className="btn-secondary btn-sm">
                                    {t('common.cancel')}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button onClick={() => setShowRejectBox(r.id)} disabled={actionLoading === r.id} className="btn-secondary btn-sm text-error-600 flex-1">
                                <XCircle className="h-4 w-4" /> {t('admin.receiptReject')}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

              <Pagination
                page={receiptsPage}
                totalPages={Math.ceil(receiptsTotal / PAGE_SIZE)}
                onPageChange={setReceiptsPage}
                t={t}
                rtl={dir === 'rtl'}
              />
              </>
            )}
          </>
        )}

        {/* ===== PAYOUTS TAB ===== */}
        {tab === 'payouts' && (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  placeholder={t('admin.payoutSearch')}
                  value={payoutsSearch}
                  onChange={(e) => { setPayoutsSearch(e.target.value); setPayoutsPage(0); }}
                  className="input pl-10"
                />
              </div>
              <select value={payoutsStatusFilter} onChange={(e) => { setPayoutsStatusFilter(e.target.value); setPayoutsPage(0); }} className="input sm:w-48">
                <option value="all">{t('admin.allPayoutStatuses')}</option>
                <option value="pending">{t('admin.payoutStatus.pending')}</option>
                <option value="approved">{t('admin.payoutStatus.approved')}</option>
                <option value="processing">{t('admin.payoutStatus.processing')}</option>
                <option value="completed">{t('admin.payoutStatus.completed')}</option>
                <option value="rejected">{t('admin.payoutStatus.rejected')}</option>
              </select>
              {payoutFiltersActive && (
                <button onClick={clearPayoutFilters} className="btn-secondary btn-sm shrink-0">
                  <X className="h-4 w-4" /> {t('admin.clearFilters')}
                </button>
              )}
            </div>

            {payoutsLoading ? (
              <SkeletonTable rows={5} columns={9} />
            ) : payoutsError ? (
              <div className="card"><ErrorState message={t('admin.failedLoadPayouts')} onRetry={fetchPayouts} retryLabel={t('common.retry')} /></div>
            ) : payouts.length === 0 ? (
              <div className="card"><EmptyState icon={<Wallet className="h-8 w-8" />} title={payoutFiltersActive ? t('admin.noPayoutsMatched') : t('admin.noPayouts')} /></div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="card hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-700 text-left text-xs font-medium text-slate-500 dark:text-slate-400">
                      <th className="px-4 py-3">{t('admin.payoutOrder')}</th>
                      <th className="px-4 py-3">{t('admin.payoutTraveler')}</th>
                      <th className="px-4 py-3">{t('admin.payoutGross')}</th>
                      <th className="px-4 py-3">{t('admin.payoutFee')}</th>
                      <th className="px-4 py-3">{t('admin.payoutNet')}</th>
                      <th className="px-4 py-3">{t('admin.payoutMethod')}</th>
                      <th className="px-4 py-3">{t('admin.payoutDestination')}</th>
                      <th className="px-4 py-3">{t('admin.payoutStatus')}</th>
                      <th className="px-4 py-3">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.map((p) => (
                      <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800/50 dark:bg-black/60">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white break-all">{p.orders?.order_number ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.traveler_profile?.full_name ?? t('admin.deletedUser')}</td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{p.gross_amount} {p.currency}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.platform_fee} {p.currency}</td>
                        <td className="px-4 py-3 font-semibold text-success-600">{p.net_amount} {p.currency}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t(`order.action.payoutMethodType.${p.payout_method}` as TranslationKey)}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs break-all" dir="ltr">{p.payout_identifier}</td>
                        <td className="px-4 py-3"><PayoutStatusBadge status={p.status} t={t} /></td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {p.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => setConfirmAction({ type: 'approvePayout', id: p.id, label: p.orders?.order_number })}
                                  disabled={actionLoading === p.id}
                                  className="btn-primary btn-sm bg-success-600 hover:bg-success-700"
                                >
                                  <Check className="h-4 w-4" /> {t('admin.payoutApprove')}
                                </button>
                                {payoutRejectBox === p.id ? (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <input
                                      type="text"
                                      value={payoutRejectReason}
                                      onChange={(e) => setPayoutRejectReason(e.target.value)}
                                      placeholder={t('admin.payoutRejectReasonPrompt')}
                                      className="input btn-sm w-full sm:w-48"
                                    />
                                    <button
                                      onClick={() => handleRejectPayout(p.id)}
                                      disabled={!payoutRejectReason.trim() || actionLoading === p.id}
                                      className="btn-primary btn-sm bg-error-600 hover:bg-error-700"
                                    >
                                      {t('admin.payoutReject')}
                                    </button>
                                    <button onClick={() => { setPayoutRejectBox(null); setPayoutRejectReason(''); }} className="btn-secondary btn-sm">
                                      {t('common.cancel')}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setPayoutRejectBox(p.id)}
                                    disabled={actionLoading === p.id}
                                    className="btn-secondary btn-sm text-error-600"
                                  >
                                    <XCircle className="h-4 w-4" /> {t('admin.payoutReject')}
                                  </button>
                                )}
                              </>
                            )}
                            {(p.status === 'approved' || p.status === 'processing') && (
                              <button
                                onClick={() => setConfirmAction({ type: 'markPayoutPaid', id: p.id, label: p.orders?.order_number })}
                                disabled={actionLoading === p.id}
                                className="btn-primary btn-sm"
                              >
                                <Check className="h-4 w-4" /> {t('admin.payoutMarkPaid')}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

                {/* Mobile cards */}
                <div className="space-y-3 md:hidden">
                  {payouts.map((p) => (
                    <div key={p.id} className="card p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-900 dark:text-white break-all">{p.orders?.order_number ?? '—'}</span>
                        <PayoutStatusBadge status={p.status} t={t} />
                      </div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-500 dark:text-slate-400">{t('admin.payoutTraveler')}</span>
                          <span className="text-slate-700 dark:text-slate-300">{p.traveler_profile?.full_name ?? t('admin.deletedUser')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 dark:text-slate-400">{t('admin.payoutGross')}</span>
                          <span className="text-slate-700 dark:text-slate-300">{p.gross_amount} {p.currency}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 dark:text-slate-400">{t('admin.payoutFee')}</span>
                          <span className="text-slate-600 dark:text-slate-400">{p.platform_fee} {p.currency}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 dark:text-slate-400">{t('admin.payoutNet')}</span>
                          <span className="font-semibold text-success-600">{p.net_amount} {p.currency}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 dark:text-slate-400">{t('admin.payoutMethod')}</span>
                          <span className="text-slate-600 dark:text-slate-400">{t(`order.action.payoutMethodType.${p.payout_method}` as TranslationKey)}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-slate-500 dark:text-slate-400 shrink-0">{t('admin.payoutDestination')}</span>
                          <span className="text-slate-600 dark:text-slate-400 text-xs break-all text-right" dir="ltr">{p.payout_identifier}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {p.status === 'pending' && (
                          <>
                            <button
                              onClick={() => setConfirmAction({ type: 'approvePayout', id: p.id, label: p.orders?.order_number })}
                              disabled={actionLoading === p.id}
                              className="btn-primary btn-sm bg-success-600 hover:bg-success-700 flex-1"
                            >
                              <Check className="h-4 w-4" /> {t('admin.payoutApprove')}
                            </button>
                            {payoutRejectBox === p.id ? (
                              <div className="w-full space-y-2">
                                <input
                                  type="text"
                                  value={payoutRejectReason}
                                  onChange={(e) => setPayoutRejectReason(e.target.value)}
                                  placeholder={t('admin.payoutRejectReasonPrompt')}
                                  className="input btn-sm w-full"
                                />
                                <div className="flex gap-2">
                                  <button onClick={() => handleRejectPayout(p.id)} disabled={!payoutRejectReason.trim() || actionLoading === p.id} className="btn-primary btn-sm bg-error-600 hover:bg-error-700 flex-1">
                                    {t('admin.payoutReject')}
                                  </button>
                                  <button onClick={() => { setPayoutRejectBox(null); setPayoutRejectReason(''); }} className="btn-secondary btn-sm">
                                    {t('common.cancel')}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button onClick={() => setPayoutRejectBox(p.id)} disabled={actionLoading === p.id} className="btn-secondary btn-sm text-error-600 flex-1">
                                <XCircle className="h-4 w-4" /> {t('admin.payoutReject')}
                              </button>
                            )}
                          </>
                        )}
                        {(p.status === 'approved' || p.status === 'processing') && (
                          <button
                            onClick={() => setConfirmAction({ type: 'markPayoutPaid', id: p.id, label: p.orders?.order_number })}
                            disabled={actionLoading === p.id}
                            className="btn-primary btn-sm flex-1"
                          >
                            <Check className="h-4 w-4" /> {t('admin.payoutMarkPaid')}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

              <Pagination
                page={payoutsPage}
                totalPages={Math.ceil(payoutsTotal / PAGE_SIZE)}
                onPageChange={setPayoutsPage}
                t={t}
                rtl={dir === 'rtl'}
              />
              </>
            )}
          </>
        )}
      </div>
      <ConfirmDialog
        open={!!confirmAction}
        title={
          confirmAction?.type === 'completePayment' ? t('admin.markPaidConfirm') :
          confirmAction?.type === 'approveReceipt' ? t('admin.receiptApproveConfirm') :
          confirmAction?.type === 'approvePayout' ? t('admin.payoutApproveConfirm') :
          t('admin.payoutMarkPaidConfirm')
        }
        message={
          confirmAction?.type === 'completePayment' ? t('admin.markPaidConfirm') :
          confirmAction?.type === 'approveReceipt' ? t('admin.receiptApproveConfirm') :
          confirmAction?.type === 'approvePayout' ? t('admin.payoutApproveConfirm') :
          t('admin.payoutMarkPaidConfirm')
        }
        confirmLabel={t('admin.confirmAction')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          if (confirmAction?.type === 'completePayment') handleCompletePayment();
          else if (confirmAction?.type === 'approveReceipt') handleApproveReceipt();
          else if (confirmAction?.type === 'approvePayout') handleApprovePayout();
          else handleMarkPayoutPaid();
        }}
        onCancel={() => setConfirmAction(null)}
        loading={!!actionLoading}
        entityLabel={confirmAction?.label}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </AdminLayout>
  );
}

function SortableTh({ label, col, sortState, onSort, icon }: { label: string; col: string; sortState: SortState; onSort: (col: string) => void; icon: React.ReactNode }) {
  const isActive = sortState.col === col;
  return (
    <th className="px-4 py-3">
      <button
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-slate-700 dark:hover:text-slate-200 ${isActive ? 'text-slate-700 dark:text-slate-200' : ''}`}
      >
        {label}
        {icon}
      </button>
    </th>
  );
}

function TabButton({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={`relative whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-primary-600 text-primary-600 dark:text-primary-400'
          : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
      }`}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="ml-2 inline-flex items-center justify-center rounded-full bg-error-500 text-white text-xs px-1.5 py-0.5 min-w-[1.25rem]">
          {badge}
        </span>
      )}
    </button>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    primary: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400',
    success: 'bg-success-50 text-success-600',
    warning: 'bg-warning-50 text-warning-600',
    error: 'bg-error-50 text-error-600',
    accent: 'bg-accent-50 text-accent-600',
  };
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colors[color]}`}>{icon}</div>
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
          <p className="text-xl font-bold text-slate-900 dark:text-white">{value}</p>
        </div>
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

function PayoutStatusBadge({ status, t }: { status: PayoutStatus; t: (k: TranslationKey) => string }) {
  const map: Record<PayoutStatus, string> = {
    pending: 'badge-warning',
    approved: 'badge-accent',
    processing: 'badge-accent',
    completed: 'badge-success',
    rejected: 'badge-error',
  };
  const labelKey: Record<PayoutStatus, TranslationKey> = {
    pending: 'admin.payoutStatus.pending',
    approved: 'admin.payoutStatus.approved',
    processing: 'admin.payoutStatus.processing',
    completed: 'admin.payoutStatus.completed',
    rejected: 'admin.payoutStatus.rejected',
  };
  return <span className={map[status]}>{t(labelKey[status])}</span>;
}
