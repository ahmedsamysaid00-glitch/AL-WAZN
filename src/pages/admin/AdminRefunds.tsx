import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { useLanguage } from '@/i18n/useLanguage';
import { AdminLayout } from './AdminLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { ConfirmDialog, PromptDialog } from '@/components/ui/ConfirmDialog';
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import { RotateCcw, Check, Play, ChevronLeft, ChevronRight, XCircle, CheckCircle2 } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { RefundWithDetails, RefundStatus } from '@/types/database';

const PAGE_SIZE = 10;

export function AdminRefunds() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const [refunds, setRefunds] = useState<RefundWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'approve' | 'process' | 'complete'; refund: RefundWithDetails } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RefundWithDetails | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  const fetchRefunds = useCallback(async () => {
    setLoading(true);
    setError(false);
    let query = supabase.from('refunds').select(`
      *,
      payments(amount, currency, status),
      orders(order_number),
      requester_profile:profiles!refunds_requested_by_fkey(full_name),
      approver_profile:profiles!refunds_approved_by_fkey(full_name)
    `, { count: 'exact' });
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    query = query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, error: err, count } = await query;
    if (err) { setError(true); setLoading(false); return; }
    setRefunds((data as RefundWithDetails[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [statusFilter, page]);

  useEffect(() => { fetchRefunds(); }, [fetchRefunds]);

  useRealtimeRefresh(
    [{ table: 'refunds' }, { table: 'wallet_accounts' }, { table: 'financial_ledger_entries' }],
    () => fetchRefunds(),
  );

  const handleReject = async (reason: string) => {
    if (!rejectTarget || !reason) return;
    setRejecting(true);
    setActionLoading(rejectTarget.id);
    const { error: err } = await supabase.rpc('reject_refund', { p_refund_id: rejectTarget.id, p_reason: reason });
    setRejecting(false);
    setActionLoading(null);
    if (err) { showToast('error', t('refunds.rejectFailed')); return; }
    showToast('success', t('refunds.rejectSuccess'));
    setRejectTarget(null);
    fetchRefunds();
  };

  const handleComplete = async () => {
    if (!confirmAction || confirmAction.type !== 'complete') return;
    const id = confirmAction.refund.id;
    setActionLoading(id);
    const { error: err } = await supabase.rpc('complete_refund', { p_refund_id: id });
    setActionLoading(null);
    if (err) { showToast('error', t('refunds.completeFailed')); return; }
    showToast('success', t('refunds.completeSuccess'));
    setConfirmAction(null);
    fetchRefunds();
  };

  const handleApprove = async () => {
    if (!confirmAction || confirmAction.type !== 'approve') return;
    const id = confirmAction.refund.id;
    setActionLoading(id);
    const { error: err } = await supabase.rpc('approve_refund', { p_refund_id: id });
    setActionLoading(null);
    if (err) { showToast('error', t('refunds.approveFailed')); return; }
    showToast('success', t('refunds.approveSuccess'));
    setConfirmAction(null);
    fetchRefunds();
  };

  const handleProcess = async () => {
    if (!confirmAction || confirmAction.type !== 'process') return;
    const id = confirmAction.refund.id;
    setActionLoading(id);
    const { error: err } = await supabase.rpc('process_refund', { p_refund_id: id });
    setActionLoading(null);
    if (err) { showToast('error', t('refunds.processFailed')); return; }
    showToast('success', t('refunds.processSuccess'));
    setConfirmAction(null);
    fetchRefunds();
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('refunds.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('refunds.subtitle')}</p>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3">
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} className="input sm:w-48">
            <option value="all">{t('admin.allPaymentStatuses')}</option>
            <option value="requested">{t('refunds.status.requested')}</option>
            <option value="approved">{t('refunds.status.approved')}</option>
            <option value="processing">{t('refunds.status.processing')}</option>
            <option value="completed">{t('refunds.status.completed')}</option>
            <option value="failed">{t('refunds.status.failed')}</option>
            <option value="cancelled">{t('refunds.status.cancelled')}</option>
          </select>
        </div>

        {/* List */}
        {loading ? (
          <div className="card"><LoadingState /></div>
        ) : error ? (
          <div className="card"><ErrorState message={t('admin.failedRefunds')} onRetry={fetchRefunds} retryLabel={t('common.retry')} /></div>
        ) : refunds.length === 0 ? (
          <div className="card"><EmptyState icon={<RotateCcw className="h-8 w-8" />} title={t('refunds.empty')} /></div>
        ) : (
          <>
            <div className="space-y-3">
              {refunds.map((r) => (
                <div key={r.id} className="card p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <RefundStatusBadge status={r.status} t={t} />
                        {r.orders && <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{r.orders.order_number}</span>}
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400">
                        <span>{t('refunds.amount')}: <span className="font-semibold text-slate-900 dark:text-white">{r.amount} {r.payments?.currency ?? ''}</span></span>
                        <span>{t('refunds.payment')}: <span className="font-semibold text-slate-700 dark:text-slate-300">{r.payments?.amount ?? '—'} {r.payments?.currency ?? ''}</span></span>
                      </div>
                      {r.reason && <p className="text-sm text-slate-500 dark:text-slate-400">{t('refunds.reason')}: {r.reason}</p>}
                      <div className="flex flex-wrap gap-4 text-xs text-slate-400 dark:text-slate-500">
                        <span>{t('refunds.requestedBy')}: {r.requester_profile?.full_name ?? t('admin.deletedUser')}</span>
                        {r.approved_by && <span>{t('refunds.approvedBy')}: {r.approver_profile?.full_name ?? t('admin.deletedUser')}</span>}
                        <span>{t('refunds.createdAt')}: {new Date(r.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {r.status === 'requested' && (
                        <>
                          <button onClick={() => setConfirmAction({ type: 'approve', refund: r })} disabled={actionLoading === r.id} className="btn-primary btn-sm">
                            <Check className="h-4 w-4" /> {t('refunds.approve')}
                          </button>
                          <button onClick={() => setRejectTarget(r)} disabled={actionLoading === r.id} className="btn-secondary btn-sm">
                            <XCircle className="h-4 w-4" /> {t('refunds.reject')}
                          </button>
                        </>
                      )}
                      {r.status === 'approved' && (
                        <button onClick={() => setConfirmAction({ type: 'process', refund: r })} disabled={actionLoading === r.id} className="btn-secondary btn-sm">
                          <Play className="h-4 w-4" /> {t('refunds.process')}
                        </button>
                      )}
                      {r.status === 'processing' && (
                        <button onClick={() => setConfirmAction({ type: 'complete', refund: r })} disabled={actionLoading === r.id} className="btn-primary btn-sm">
                          <CheckCircle2 className="h-4 w-4" /> {t('refunds.complete')}
                        </button>
                      )}
                    </div>
                  </div>
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
      </div>
      <ConfirmDialog
        open={!!confirmAction}
        title={
          confirmAction?.type === 'approve' ? t('refunds.approveConfirm') :
          confirmAction?.type === 'process' ? t('refunds.processConfirm') :
          t('refunds.completeConfirm')
        }
        message={
          confirmAction?.type === 'approve' ? t('refunds.approveConfirm') :
          confirmAction?.type === 'process' ? t('refunds.processConfirm') :
          t('refunds.completeConfirm')
        }
        confirmLabel={t('admin.confirmAction')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          if (confirmAction?.type === 'approve') handleApprove();
          else if (confirmAction?.type === 'process') handleProcess();
          else handleComplete();
        }}
        onCancel={() => setConfirmAction(null)}
        loading={!!actionLoading}
        entityLabel={confirmAction ? `${confirmAction.refund.amount} ${confirmAction.refund.payments?.currency ?? ''}` : undefined}
      />
      <PromptDialog
        open={!!rejectTarget}
        title={t('refunds.reject')}
        message={t('refunds.rejectReasonPrompt')}
        label={t('refunds.rejectReasonLabel')}
        submitLabel={t('refunds.reject')}
        cancelLabel={t('common.cancel')}
        onSubmit={(value) => handleReject(value)}
        onCancel={() => setRejectTarget(null)}
        loading={rejecting}
        multiline
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </AdminLayout>
  );
}

function RefundStatusBadge({ status, t }: { status: RefundStatus; t: (k: TranslationKey) => string }) {
  const map: Record<RefundStatus, string> = {
    requested: 'badge-warning', approved: 'badge-accent', processing: 'badge-accent',
    completed: 'badge-success', failed: 'badge-error', cancelled: 'badge-neutral',
  };
  const labelKey: Record<RefundStatus, TranslationKey> = {
    requested: 'refunds.status.requested', approved: 'refunds.status.approved', processing: 'refunds.status.processing',
    completed: 'refunds.status.completed', failed: 'refunds.status.failed', cancelled: 'refunds.status.cancelled',
  };
  return <span className={map[status]}>{t(labelKey[status])}</span>;
}
