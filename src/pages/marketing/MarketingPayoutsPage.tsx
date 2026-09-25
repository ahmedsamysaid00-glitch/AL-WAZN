import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { MarketingLayout } from './MarketingLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import {
  Wallet,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  XCircle,
  DollarSign,
  Info,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';

type PayoutFilter = 'all' | 'pending' | 'completed' | 'cancelled';

interface PayoutRow {
  id: string;
  marketer_id: string;
  amount: number;
  currency: string;
  status: string;
  payout_method: string | null;
  payout_reference: string | null;
  commission_ids: string[];
  created_at: string;
  completed_at: string | null;
  completed_by: string | null;
  completed_by_name: string | null;
  notes: string | null;
  total_count: number;
}

interface SummaryRow {
  currency: string;
  total_paid: number;
  total_pending: number;
  available_balance: number;
}

const PAGE_SIZE = 10;

const FILTER_OPTIONS: { value: PayoutFilter; labelKey: TranslationKey }[] = [
  { value: 'all', labelKey: 'marketing.filterAll' },
  { value: 'pending', labelKey: 'marketing.payoutsStatusPending' },
  { value: 'completed', labelKey: 'marketing.payoutsStatusCompleted' },
  { value: 'cancelled', labelKey: 'marketing.payoutsStatusCancelled' },
];

export function MarketingPayoutsPage() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const marketerId = profile?.id ?? '';

  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<PayoutFilter>('all');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const fetchSummary = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('get_marketer_payouts_summary');
    if (!err && data) {
      setSummary(data as SummaryRow[]);
    }
  }, []);

  const fetchPayouts = useCallback(async () => {
    setError(false);
    const { data, error: err } = await supabase.rpc('get_marketer_payouts', {
      p_status_filter: filter === 'all' ? null : filter,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });

    if (err) {
      setError(true);
      setPayouts([]);
      setTotalCount(0);
      return;
    }

    const rows = (data as PayoutRow[]) ?? [];
    setPayouts(rows);
    setTotalCount(rows.length > 0 ? Number(rows[0].total_count) : 0);
  }, [filter, page]);

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchSummary(), fetchPayouts()]);
  }, [fetchSummary, fetchPayouts]);

  const fetchAllInitial = useCallback(async () => {
    setLoading(true);
    await fetchAll();
    setLoading(false);
  }, [fetchAll]);

  useEffect(() => {
    fetchAllInitial();
  }, [fetchAllInitial]);

  useEffect(() => {
    setPage(0);
  }, [filter]);

  useRealtimeRefresh(
    [
      { table: 'marketing_payouts', filter: `marketer_id=eq.${marketerId}` },
      { table: 'marketing_commissions', filter: `marketer_id=eq.${marketerId}` },
    ],
    () => fetchAll(),
    !!marketerId,
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = page + 1;
  const hasNext = currentPage < totalPages;
  const hasPrev = page > 0;

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400',
      completed: 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400',
      cancelled: 'bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400',
    };
    const icons: Record<string, React.ReactNode> = {
      pending: <Clock className="h-3 w-3" />,
      completed: <CheckCircle2 className="h-3 w-3" />,
      cancelled: <XCircle className="h-3 w-3" />,
    };
    const labelKey: Record<string, TranslationKey> = {
      pending: 'marketing.payoutsStatusPending',
      completed: 'marketing.payoutsStatusCompleted',
      cancelled: 'marketing.payoutsStatusCancelled',
    };
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${styles[status] ?? styles.pending}`}>
        {icons[status]}
        {t(labelKey[status] ?? 'marketing.payoutsStatusPending')}
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('marketing.payoutsTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('marketing.payoutsSubtitle')}</p>
        </div>

        {/* Info banner — payout requests are admin-managed */}
        <div className="flex items-start gap-3 rounded-lg bg-primary-50 dark:bg-primary-900/20 px-4 py-3">
          <Info className="h-5 w-5 text-primary-600 dark:text-primary-400 shrink-0 mt-0.5" />
          <p className="text-sm text-primary-700 dark:text-primary-300">
            {t('marketing.payoutsAdminManaged')}
          </p>
        </div>

        {/* Summary Cards — per currency */}
        {summary.length > 0 && (
          <div className="space-y-3">
            {summary.map((s) => (
              <div key={s.currency} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <SummaryCard
                  icon={<DollarSign className="h-5 w-5" />}
                  label={t('marketing.payoutsAvailable')}
                  value={formatCurrency(s.available_balance, s.currency)}
                  color="text-success-600 dark:text-success-400"
                  sub={s.currency}
                />
                <SummaryCard
                  icon={<Clock className="h-5 w-5" />}
                  label={t('marketing.payoutsPendingAmount')}
                  value={formatCurrency(s.total_pending, s.currency)}
                  color="text-warning-600 dark:text-warning-400"
                  sub={s.currency}
                />
                <SummaryCard
                  icon={<CheckCircle2 className="h-5 w-5" />}
                  label={t('marketing.payoutsPaidAmount')}
                  value={formatCurrency(s.total_paid, s.currency)}
                  color="text-primary-600 dark:text-primary-400"
                  sub={s.currency}
                />
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
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
        </div>

        {/* Content */}
        {loading ? (
          <div className="card"><LoadingState label={t('marketing.payoutsLoading')} /></div>
        ) : error ? (
          <div className="card">
            <ErrorState message={t('marketing.payoutsFailed')} onRetry={fetchAll} retryLabel={t('common.retry')} />
          </div>
        ) : payouts.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<Wallet className="h-8 w-8" />}
              title={filter !== 'all' ? t('marketing.payoutsEmptyFiltered') : t('marketing.payoutsEmpty')}
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
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colAmount')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colStatus')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.payoutsColMethod')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.payoutsColReference')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colCreatedDate')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.payoutsColCompletedDate')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.payoutsColCommissions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {payouts.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-4 py-3">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {formatCurrency(p.amount, p.currency)}
                          </span>
                        </td>
                        <td className="px-4 py-3">{statusBadge(p.status)}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {p.payout_method ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {p.payout_reference ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {formatDate(p.created_at)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {formatDate(p.completed_at)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {p.commission_ids.length > 0 ? p.commission_ids.length : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Cards */}
            <div className="space-y-2 md:hidden">
              {payouts.map((p) => (
                <div key={p.id} className="card p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-lg font-bold text-slate-900 dark:text-white">
                        {formatCurrency(p.amount, p.currency)}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        {p.payout_method ?? t('marketing.payoutsNoMethod')}
                      </p>
                    </div>
                    {statusBadge(p.status)}
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
                    <div className="flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {formatDate(p.created_at)}
                    </div>
                    {p.completed_at && (
                      <div className="flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-success-500" />
                        {formatDate(p.completed_at)}
                      </div>
                    )}
                  </div>
                  {p.payout_reference && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t('marketing.payoutsColReference')}: {p.payout_reference}
                    </p>
                  )}
                  {p.notes && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{p.notes}</p>
                  )}
                  {p.commission_ids.length > 0 && (
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      {t('marketing.payoutsColCommissions')}: {p.commission_ids.length}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('marketing.pageOf').replace('{page}', String(currentPage)).replace('{total}', String(totalPages))}
                {' · '}
                {totalCount} {t('marketing.payoutsTitle').toLowerCase()}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={!hasPrev}
                  className="btn-ghost btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasNext}
                  className="btn-ghost btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Next page"
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
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  sub?: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={color}>{icon}</span>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
        {sub && <span className="text-xs text-slate-400 dark:text-slate-500 ms-auto">{sub}</span>}
      </div>
      <p className="text-xl font-bold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
