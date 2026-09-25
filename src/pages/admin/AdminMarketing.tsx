import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { AdminLayout } from './AdminLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { ConfirmDialog, PromptDialog } from '@/components/ui/ConfirmDialog';
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import {
  Megaphone,
  DollarSign,
  Clock,
  CheckCircle2,
  Wallet,
  Check,
  XCircle,
  Loader2,
  TrendingUp,
} from 'lucide-react';
import type {
  MarketingSettings,
  MarketingCommission,
  CommissionStatus,
} from '@/types/database';

export function AdminMarketing() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [settings, setSettings] = useState<MarketingSettings | null>(null);
  const [commissions, setCommissions] = useState<MarketingCommission[]>([]);
  const [marketerEmail, setMarketerEmail] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'approve' | 'pay'; commission: MarketingCommission } | null>(null);
  const [reverseTarget, setReverseTarget] = useState<MarketingCommission | null>(null);
  const [reversing, setReversing] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [settingsRes, commissionsRes, platformRes] = await Promise.all([
        supabase.from('marketing_settings').select('*').limit(1).maybeSingle(),
        supabase.from('marketing_commissions').select('*').order('created_at', { ascending: false }),
        supabase.from('platform_settings').select('marketer_email').limit(1).maybeSingle(),
      ]);

      if (settingsRes.data) setSettings(settingsRes.data as MarketingSettings);
      setCommissions((commissionsRes.data as MarketingCommission[]) ?? []);
      if (platformRes.data) setMarketerEmail((platformRes.data as { marketer_email: string }).marketer_email);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useRealtimeRefresh(
    [{ table: 'marketing_commissions' }, { table: 'marketing_settings' }],
    () => fetchData(),
  );

  const handleApprove = async () => {
    if (!confirmAction || confirmAction.type !== 'approve') return;
    const id = confirmAction.commission.id;
    setActionLoading(id);
    const { error: rpcError } = await supabase.rpc('approve_commission', { p_commission_id: id });
    setActionLoading(null);
    if (rpcError) { showToast('error', t('marketing.adminApproveFailed')); return; }
    showToast('success', t('marketing.adminApproveSuccess'));
    setConfirmAction(null);
    fetchData();
  };

  const handlePay = async () => {
    if (!confirmAction || confirmAction.type !== 'pay') return;
    const id = confirmAction.commission.id;
    setActionLoading(id);
    const { error: rpcError } = await supabase.rpc('pay_commission', { p_commission_id: id });
    setActionLoading(null);
    if (rpcError) { showToast('error', t('marketing.adminPayFailed')); return; }
    showToast('success', t('marketing.adminPaySuccess'));
    setConfirmAction(null);
    fetchData();
  };

  const handleReverse = async (reason: string) => {
    if (!reverseTarget || !reason) return;
    setReversing(true);
    setActionLoading(reverseTarget.id);
    const { error: rpcError } = await supabase.rpc('reverse_commission', {
      p_commission_id: reverseTarget.id,
      p_reason: reason,
    });
    setReversing(false);
    setActionLoading(null);
    if (rpcError) { showToast('error', t('marketing.adminReverseFailed')); return; }
    showToast('success', t('marketing.adminReverseSuccess'));
    setReverseTarget(null);
    fetchData();
  };

  const statusBadgeClass = (status: CommissionStatus): string => {
    switch (status) {
      case 'pending': return 'bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400';
      case 'approved': return 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400';
      case 'paid': return 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400';
      case 'reversed':
      case 'cancelled': return 'bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400';
      default: return 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400';
    }
  };

  const formatCurrency = (amount: number, currency: string): string => {
    return `${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  };

  const filteredCommissions = filterStatus === 'all'
    ? commissions
    : commissions.filter((c) => c.status === filterStatus);

  const pendingTotal = commissions.filter((c) => c.status === 'pending').reduce((s, c) => s + Number(c.commission_amount), 0);
  const approvedTotal = commissions.filter((c) => c.status === 'approved').reduce((s, c) => s + Number(c.commission_amount), 0);
  const paidTotal = commissions.filter((c) => c.status === 'paid').reduce((s, c) => s + Number(c.commission_amount), 0);
  const totalLiability = pendingTotal + approvedTotal;

  if (loading) {
    return (
      <AdminLayout>
        <LoadingState label={t('marketing.loadingCommissions')} />
      </AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout>
        <ErrorState message={t('marketing.failedCommissions')} onRetry={fetchData} retryLabel={t('common.retry')} />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('marketing.adminMarketingTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('marketing.adminMarketingSubtitle')}</p>
        </div>

        {/* Marketer Info */}
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
              <Megaphone className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t('marketing.adminMarketerInfo')}</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400" dir="ltr">
                {marketerEmail ?? t('admin.notSet')}
              </p>
              {settings?.referral_code && (
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">
                  {t('marketing.referralCode')}: <span className="font-mono font-semibold">{settings.referral_code}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
              <Clock className="h-5 w-5" />
              <span className="text-xs font-medium">{t('marketing.adminPendingCommissions')}</span>
            </div>
            <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{formatCurrency(pendingTotal, 'EGP')}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-xs font-medium">{t('marketing.adminApprovedCommissions')}</span>
            </div>
            <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{formatCurrency(approvedTotal, 'EGP')}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
              <Wallet className="h-5 w-5" />
              <span className="text-xs font-medium">{t('marketing.adminPaidCommissions')}</span>
            </div>
            <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{formatCurrency(paidTotal, 'EGP')}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
              <TrendingUp className="h-5 w-5" />
              <span className="text-xs font-medium">{t('marketing.adminTotalLiability')}</span>
            </div>
            <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{formatCurrency(totalLiability, 'EGP')}</p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('marketing.filterStatus')}</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="input max-w-48"
          >
            <option value="all">{t('marketing.allStatuses')}</option>
            <option value="pending">{t('marketing.status.pending')}</option>
            <option value="approved">{t('marketing.status.approved')}</option>
            <option value="paid">{t('marketing.status.paid')}</option>
            <option value="reversed">{t('marketing.status.reversed')}</option>
            <option value="cancelled">{t('marketing.status.cancelled')}</option>
          </select>
        </div>

        {/* Commissions Table */}
        <div className="card overflow-hidden">
          {filteredCommissions.length === 0 ? (
            <EmptyState icon={<DollarSign className="h-8 w-8" />} title={t('marketing.noCommissionResults')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-start font-medium">{t('marketing.colOrder')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('marketing.colOrderAmount')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('marketing.colPlatformFee')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('marketing.colCommissionAmount')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('marketing.colStatus')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('marketing.colCreatedDate')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {filteredCommissions.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                        {c.order_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{formatCurrency(Number(c.gross_order_amount), c.currency)}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{formatCurrency(Number(c.platform_fee_amount), c.currency)}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{formatCurrency(Number(c.commission_amount), c.currency)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClass(c.status)}`}>
                          {t(`marketing.status.${c.status}` as never)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                        {new Date(c.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {c.status === 'pending' && (
                            <button
                              onClick={() => setConfirmAction({ type: 'approve', commission: c })}
                              disabled={actionLoading === c.id}
                              className="btn-secondary btn-xs"
                            >
                              {actionLoading === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              {t('marketing.adminApproveCommission')}
                            </button>
                          )}
                          {c.status === 'approved' && (
                            <button
                              onClick={() => setConfirmAction({ type: 'pay', commission: c })}
                              disabled={actionLoading === c.id}
                              className="btn-primary btn-xs"
                            >
                              {actionLoading === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wallet className="h-3 w-3" />}
                              {t('marketing.adminPayCommission')}
                            </button>
                          )}
                          {(c.status === 'pending' || c.status === 'approved') && (
                            <button
                              onClick={() => setReverseTarget(c)}
                              disabled={actionLoading === c.id}
                              className="btn-ghost btn-xs text-error-600 dark:text-error-400"
                            >
                              <XCircle className="h-3 w-3" />
                              {t('marketing.adminReverseCommission')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.type === 'approve' ? t('marketing.adminApproveConfirm') : t('marketing.adminPayConfirm')}
        message={confirmAction?.type === 'approve' ? t('marketing.adminApproveConfirm') : t('marketing.adminPayConfirm')}
        confirmLabel={t('admin.confirmAction')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          if (confirmAction?.type === 'approve') handleApprove();
          else handlePay();
        }}
        onCancel={() => setConfirmAction(null)}
        loading={!!actionLoading}
        entityLabel={confirmAction ? `${formatCurrency(Number(confirmAction.commission.commission_amount), confirmAction.commission.currency)}` : undefined}
      />
      <PromptDialog
        open={!!reverseTarget}
        title={t('marketing.adminReverseCommission')}
        message={t('marketing.adminReverseReasonPrompt')}
        label={t('marketing.adminReverseReasonLabel')}
        submitLabel={t('marketing.adminReverseCommission')}
        cancelLabel={t('common.cancel')}
        onSubmit={(value) => handleReverse(value)}
        onCancel={() => setReverseTarget(null)}
        loading={reversing}
        multiline
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </AdminLayout>
  );
}
