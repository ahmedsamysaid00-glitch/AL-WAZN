import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { MarketingLayout } from './MarketingLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import {
  DollarSign,
  Search,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  TrendingUp,
  Wallet,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import type { CommissionStatus, CommissionBaseType } from '@/types/database';
import type { TranslationKey } from '@/i18n/translations';

type CommissionFilter = 'all' | CommissionStatus;

interface CommissionRow {
  id: string;
  marketer_id: string;
  referred_user_id: string | null;
  referral_id: string | null;
  order_id: string;
  payment_id: string | null;
  gross_order_amount: number;
  platform_fee_amount: number;
  commission_base_value: number;
  commission_rate: number;
  commission_amount: number;
  commission_base_type: CommissionBaseType;
  currency: string;
  status: CommissionStatus;
  created_at: string;
  approved_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  order_number: string | null;
  order_status: string | null;
  order_created_at: string | null;
  referral_code: string | null;
  referred_user_name: string | null;
  referred_user_email: string | null;
  total_count: number;
}

const PAGE_SIZE = 10;

const FILTER_OPTIONS: { value: CommissionFilter; labelKey: TranslationKey }[] = [
  { value: 'all', labelKey: 'marketing.filterAll' },
  { value: 'pending', labelKey: 'marketing.status.pending' },
  { value: 'approved', labelKey: 'marketing.status.approved' },
  { value: 'paid', labelKey: 'marketing.status.paid' },
  { value: 'reversed', labelKey: 'marketing.status.reversed' },
  { value: 'cancelled', labelKey: 'marketing.status.cancelled' },
];

export function MarketingCommissionsPage() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const marketerId = profile?.id ?? '';

  const [commissions, setCommissions] = useState<CommissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<CommissionFilter>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [filter, debouncedSearch]);

  const fetchCommissions = useCallback(async () => {
    setError(false);
    const { data, error: err } = await supabase.rpc('get_marketer_commissions', {
      p_status_filter: filter === 'all' ? null : filter,
      p_search: debouncedSearch.trim() || null,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });

    if (err) {
      setError(true);
      setCommissions([]);
      setTotalCount(0);
      return;
    }

    const rows = (data as CommissionRow[]) ?? [];
    setCommissions(rows);
    setTotalCount(rows.length > 0 ? Number(rows[0].total_count) : 0);
  }, [filter, debouncedSearch, page]);

  const fetchCommissionsInitial = useCallback(async () => {
    setLoading(true);
    await fetchCommissions();
    setLoading(false);
  }, [fetchCommissions]);

  useEffect(() => {
    fetchCommissionsInitial();
  }, [fetchCommissionsInitial]);

  useRealtimeRefresh(
    [{ table: 'marketing_commissions', filter: `marketer_id=eq.${marketerId}` }],
    () => fetchCommissions(),
    !!marketerId,
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = page + 1;
  const hasNext = currentPage < totalPages;
  const hasPrev = page > 0;

  const pendingCount = commissions.filter((c) => c.status === 'pending').length;
  const approvedCount = commissions.filter((c) => c.status === 'approved').length;
  const paidCount = commissions.filter((c) => c.status === 'paid').length;
  const showPageCounts = filter !== 'all';

  const statusBadge = (status: CommissionStatus) => {
    const styles: Record<CommissionStatus, string> = {
      pending: 'bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400',
      approved: 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400',
      paid: 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400',
      reversed: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
      cancelled: 'bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400',
    };
    return (
      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${styles[status]}`}>
        {t(`marketing.status.${status}` as TranslationKey)}
      </span>
    );
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString();
  };

  const formatCurrency = (amount: number, currency: string) => {
    return `${amount.toFixed(2)} ${currency}`;
  };

  return (
    <MarketingLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('marketing.commissionsTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('marketing.commissionsSubtitle')}</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard
            icon={<DollarSign className="h-5 w-5" />}
            label={t('marketing.commissionsTotal')}
            value={commissions.length > 0 ? totalCount : 0}
            color="text-success-600 dark:text-success-400"
          />
          <SummaryCard
            icon={<Wallet className="h-5 w-5" />}
            label={showPageCounts ? `${t('marketing.commissionsPending')} (${t('common.page')})` : t('marketing.commissionsPending')}
            value={showPageCounts ? pendingCount : totalCount}
            color="text-warning-600 dark:text-warning-400"
          />
          <SummaryCard
            icon={<TrendingUp className="h-5 w-5" />}
            label={showPageCounts ? `${t('marketing.commissionsApproved')} (${t('common.page')})` : t('marketing.commissionsApproved')}
            value={approvedCount}
            color="text-primary-600 dark:text-primary-400"
          />
          <SummaryCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            label={showPageCounts ? `${t('marketing.commissionsPaid')} (${t('common.page')})` : t('marketing.commissionsPaid')}
            value={paidCount}
            color="text-success-600 dark:text-success-400"
          />
        </div>

        {/* Filters + Search */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === opt.value
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('marketing.commissionsSearchPlaceholder')}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 ps-9 pe-3 py-2 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-64"
            />
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="card"><LoadingState label={t('marketing.commissionsLoading')} /></div>
        ) : error ? (
          <div className="card">
            <ErrorState message={t('marketing.commissionsFailed')} onRetry={fetchCommissions} retryLabel={t('common.retry')} />
          </div>
        ) : commissions.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<DollarSign className="h-8 w-8" />}
              title={debouncedSearch || filter !== 'all' ? t('marketing.commissionsEmptyFiltered') : t('marketing.commissionsEmpty')}
            />
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="card overflow-hidden hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colOrder')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colUserName')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colCommissionAmount')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colStatus')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colCreatedDate')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colPaidDate')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {commissions.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                          {c.order_number ?? c.order_id.slice(0, 8) + '…'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {c.referred_user_name ?? t('marketing.anonymousUser')}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-success-600 dark:text-success-400">
                            {formatCurrency(c.commission_amount, c.currency)}
                          </span>
                          <p className="text-xs text-slate-400 dark:text-slate-500">
                            {t('marketing.commissionsBaseValue')}: {c.commission_base_value.toFixed(2)} {c.currency}
                          </p>
                        </td>
                        <td className="px-4 py-3">{statusBadge(c.status)}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {formatDate(c.created_at)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {formatDate(c.paid_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Cards */}
            <div className="space-y-2 md:hidden">
              {commissions.map((c) => (
                <div key={c.id} className="card p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 dark:text-white truncate">
                        {c.order_number ?? c.order_id.slice(0, 8) + '…'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {c.referred_user_name ?? t('marketing.anonymousUser')}
                      </p>
                    </div>
                    {statusBadge(c.status)}
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-bold text-success-600 dark:text-success-400">
                        {formatCurrency(c.commission_amount, c.currency)}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        {t('marketing.commissionsBaseValue')}: {c.commission_base_value.toFixed(2)} {c.currency}
                      </p>
                    </div>
                    <div className="text-end text-xs text-slate-400 dark:text-slate-500">
                      <div className="flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {formatDate(c.created_at)}
                      </div>
                      {c.paid_at && (
                        <div className="flex items-center gap-1 mt-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-success-500" />
                          {formatDate(c.paid_at)}
                        </div>
                      )}
                    </div>
                  </div>
                  {c.cancellation_reason && (
                    <div className="flex items-start gap-2 rounded-lg bg-error-50 dark:bg-error-900/20 px-3 py-2">
                      <XCircle className="h-4 w-4 text-error-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-error-700 dark:text-error-400">{c.cancellation_reason}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('marketing.pageOf').replace('{page}', String(currentPage)).replace('{total}', String(totalPages))}
                {' · '}
                {totalCount} {t('marketing.commissionsTitle').toLowerCase()}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={!hasPrev}
                  className="btn-ghost btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={t('common.previous')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasNext}
                  className="btn-ghost btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={t('common.next')}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </MarketingLayout>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={color}>{icon}</span>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      </div>
      <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
