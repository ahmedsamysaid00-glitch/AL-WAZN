import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { MarketingLayout } from './MarketingLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import {
  UserPlus,
  Search,
  Eye,
  X,
  ChevronLeft,
  ChevronRight,
  Mail,
  CalendarDays,
  CheckCircle2,
  TrendingUp,
  ShoppingBag,
  DollarSign,
} from 'lucide-react';
import type { ReferralStatus, CommissionStatus, AccountStatus } from '@/types/database';
import type { TranslationKey } from '@/i18n/translations';

type ReferralFilter = 'all' | 'registered' | 'converted' | 'not_converted' | 'active' | 'inactive';

interface ReferralRow {
  id: string;
  marketer_id: string;
  referral_code: string;
  referred_user_id: string | null;
  status: ReferralStatus;
  first_seen_at: string;
  registered_at: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
  referred_user_full_name: string | null;
  referred_user_email: string | null;
  referred_user_account_status: AccountStatus | null;
  total_commission_amount: number;
  commission_count: number;
  last_commission_date: string | null;
  commission_currency: string | null;
  total_count: number;
}

interface ReferralDetailRow {
  referral_id: string;
  referral_code: string;
  referred_user_id: string | null;
  status: ReferralStatus;
  first_seen_at: string;
  registered_at: string | null;
  converted_at: string | null;
  created_at: string;
  referred_user_full_name: string | null;
  referred_user_email: string | null;
  referred_user_account_status: AccountStatus | null;
  commission_id: string | null;
  order_id: string | null;
  commission_amount: number | null;
  gross_order_amount: number | null;
  commission_status: CommissionStatus | null;
  commission_currency: string | null;
  commission_created_at: string | null;
}

interface CommissionDetail {
  id: string;
  order_id: string;
  commission_amount: number;
  gross_order_amount: number;
  status: CommissionStatus;
  currency: string;
  created_at: string;
}

interface ReferralDetailData {
  referral: {
    id: string;
    referral_code: string;
    status: ReferralStatus;
    first_seen_at: string;
    registered_at: string | null;
    converted_at: string | null;
    created_at: string;
    referred_user_full_name: string | null;
    referred_user_email: string | null;
    referred_user_account_status: AccountStatus | null;
  };
  commissions: CommissionDetail[];
}

const PAGE_SIZE = 10;

const FILTER_OPTIONS: { value: ReferralFilter; labelKey: TranslationKey }[] = [
  { value: 'all', labelKey: 'marketing.filterAll' },
  { value: 'registered', labelKey: 'marketing.filterRegistered' },
  { value: 'converted', labelKey: 'marketing.filterConverted' },
  { value: 'not_converted', labelKey: 'marketing.filterNotConverted' },
  { value: 'active', labelKey: 'marketing.filterActive' },
  { value: 'inactive', labelKey: 'marketing.filterInactive' },
];

export function MarketingReferralsPage() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const marketerId = profile?.id ?? '';

  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<ReferralFilter>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<ReferralDetailData | null>(null);
  const [detailError, setDetailError] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [filter, debouncedSearch]);

  const fetchReferrals = useCallback(async () => {
    setError(false);
    const { data, error: err } = await supabase.rpc('get_marketer_referrals', {
      p_status_filter: filter,
      p_search: debouncedSearch.trim() || null,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });

    if (err) {
      setError(true);
      setReferrals([]);
      setTotalCount(0);
      return;
    }

    const rows = (data as ReferralRow[]) ?? [];
    setReferrals(rows);
    setTotalCount(rows.length > 0 ? Number(rows[0].total_count) : 0);
  }, [filter, debouncedSearch, page]);

  const fetchReferralsInitial = useCallback(async () => {
    setLoading(true);
    await fetchReferrals();
    setLoading(false);
  }, [fetchReferrals]);

  useEffect(() => {
    fetchReferralsInitial();
  }, [fetchReferralsInitial]);

  useRealtimeRefresh(
    [{ table: 'marketing_referrals', filter: `marketer_id=eq.${marketerId}` }],
    () => fetchReferrals(),
    !!marketerId,
  );

  const openDetail = useCallback(async (referralId: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(false);
    setDetailData(null);

    try {
      const { data, error: detailErr } = await supabase.rpc('get_marketer_referral_detail', {
        p_referral_id: referralId,
      });

      if (detailErr) throw detailErr;

      const rows = (data as ReferralDetailRow[]) ?? [];
      if (rows.length === 0) {
        setDetailError(true);
        return;
      }

      const first = rows[0];
      const commissions: CommissionDetail[] = rows
        .filter((r) => r.commission_id !== null)
        .map((r) => ({
          id: r.commission_id!,
          order_id: r.order_id!,
          commission_amount: r.commission_amount!,
          gross_order_amount: r.gross_order_amount!,
          status: r.commission_status!,
          currency: r.commission_currency!,
          created_at: r.commission_created_at!,
        }));

      setDetailData({
        referral: {
          id: first.referral_id,
          referral_code: first.referral_code,
          status: first.status,
          first_seen_at: first.first_seen_at,
          registered_at: first.registered_at,
          converted_at: first.converted_at,
          created_at: first.created_at,
          referred_user_full_name: first.referred_user_full_name,
          referred_user_email: first.referred_user_email,
          referred_user_account_status: first.referred_user_account_status,
        },
        commissions,
      });
    } catch {
      setDetailError(true);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = () => {
    setDetailOpen(false);
    setDetailData(null);
    setDetailError(false);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = page + 1;
  const hasNext = currentPage < totalPages;
  const hasPrev = page > 0;

  const statusBadge = (status: ReferralStatus) => {
    const styles: Record<ReferralStatus, string> = {
      attributed: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
      registered: 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400',
      converted: 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400',
      expired: 'bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400',
    };
    return (
      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${styles[status]}`}>
        {t(`marketing.status.${status}` as TranslationKey)}
      </span>
    );
  };

  const userStatusBadge = (status: AccountStatus | null | undefined) => {
    if (!status) return <span className="text-xs text-slate-400">—</span>;
    const styles: Record<AccountStatus, string> = {
      active: 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400',
      suspended: 'bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400',
      pending: 'bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400',
    };
    return (
      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${styles[status] ?? styles.pending}`}>
        {t(`status.${status}` as TranslationKey)}
      </span>
    );
  };

  const commissionStatusBadge = (status: CommissionStatus) => {
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

  const lastActivity = (r: ReferralRow) => {
    const dates = [r.last_commission_date, r.converted_at, r.registered_at, r.first_seen_at].filter(Boolean) as string[];
    if (dates.length === 0) return r.created_at;
    return dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  };

  return (
    <MarketingLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('marketing.referralsTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('marketing.referralsSubtitle')}</p>
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
              placeholder={t('marketing.searchPlaceholder')}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 ps-9 pe-3 py-2 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-64"
            />
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="card"><LoadingState label={t('marketing.referralsLoading')} /></div>
        ) : error ? (
          <div className="card">
            <ErrorState message={t('marketing.referralsFailed')} onRetry={fetchReferrals} retryLabel={t('common.retry')} />
          </div>
        ) : referrals.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<UserPlus className="h-8 w-8" />}
              title={debouncedSearch || filter !== 'all' ? t('marketing.referralsEmptyFiltered') : t('marketing.referralsEmpty')}
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
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colUserName')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colEmail')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colReferralDate')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colConversionStatus')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colUserStatus')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colCommission')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('marketing.colLastActivity')}</th>
                      <th className="px-4 py-3 text-end font-medium">{t('marketing.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {referrals.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                          {r.referred_user_full_name ?? t('marketing.anonymousUser')}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {r.referred_user_email ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {formatDate(r.first_seen_at)}
                        </td>
                        <td className="px-4 py-3">{statusBadge(r.status)}</td>
                        <td className="px-4 py-3">{userStatusBadge(r.referred_user_account_status)}</td>
                        <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                          {r.commission_count > 0 ? (
                            <span className="font-medium text-success-600 dark:text-success-400">
                              {r.total_commission_amount.toFixed(2)} {r.commission_currency ?? t('marketing.currencyDefault')}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {formatDate(lastActivity(r))}
                        </td>
                        <td className="px-4 py-3 text-end">
                          <button
                            onClick={() => openDetail(r.id)}
                            className="btn-ghost btn-sm"
                            aria-label={t('marketing.viewDetail')}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Cards */}
            <div className="space-y-2 md:hidden">
              {referrals.map((r) => (
                <div key={r.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-semibold text-slate-900 dark:text-white truncate">
                        {r.referred_user_full_name ?? t('marketing.anonymousUser')}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{r.referred_user_email ?? '—'}</p>
                    </div>
                    <button onClick={() => openDetail(r.id)} className="btn-ghost btn-sm shrink-0">
                      <Eye className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {statusBadge(r.status)}
                    {userStatusBadge(r.referred_user_account_status)}
                  </div>
                  {r.commission_count > 0 && (
                    <div className="mt-2 text-xs font-medium text-success-600 dark:text-success-400">
                      {r.total_commission_amount.toFixed(2)} {r.commission_currency ?? t('marketing.currencyDefault')}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {formatDate(r.first_seen_at)}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('marketing.pageOf').replace('{page}', String(currentPage)).replace('{total}', String(totalPages))}
                {' · '}
                {totalCount} {t('marketing.referralsTitle').toLowerCase()}
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

      {/* Detail Drawer */}
      {detailOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-slate-900/50 dark:bg-slate-950/50 animate-fade-in"
            onClick={closeDetail}
          />
          <div className="absolute end-0 top-0 h-full w-full max-w-md overflow-y-auto bg-white dark:bg-slate-800 shadow-xl animate-slide-in">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('marketing.referralDetailTitle')}</h2>
              <button onClick={closeDetail} className="btn-ghost btn-sm">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {detailLoading ? (
                <LoadingState label={t('common.loading')} />
              ) : detailError ? (
                <ErrorState message={t('marketing.referralsFailed')} onRetry={closeDetail} retryLabel={t('common.close')} />
              ) : detailData ? (
                <DetailContent data={detailData} t={t} statusBadge={statusBadge} userStatusBadge={userStatusBadge} commissionStatusBadge={commissionStatusBadge} formatDate={formatDate} />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </MarketingLayout>
  );
}

function DetailContent({
  data,
  t,
  statusBadge,
  userStatusBadge,
  commissionStatusBadge,
  formatDate,
}: {
  data: ReferralDetailData;
  t: (k: TranslationKey) => string;
  statusBadge: (s: ReferralStatus) => React.ReactNode;
  userStatusBadge: (s: AccountStatus | null | undefined) => React.ReactNode;
  commissionStatusBadge: (s: CommissionStatus) => React.ReactNode;
  formatDate: (d: string | null) => string;
}) {
  const { referral, commissions } = data;
  const totalCommission = commissions.reduce((sum, c) => sum + c.commission_amount, 0);
  const currency = commissions.length > 0 ? commissions[0].currency : t('marketing.currencyDefault');

  const infoRows = [
    { icon: <UserPlus className="h-4 w-4" />, label: 'marketing.colUserName', value: referral.referred_user_full_name ?? t('marketing.anonymousUser') },
    { icon: <Mail className="h-4 w-4" />, label: 'marketing.colEmail', value: referral.referred_user_email ?? '—' },
    { icon: <CalendarDays className="h-4 w-4" />, label: 'marketing.referralDetailReferralDate', value: formatDate(referral.first_seen_at) },
    { icon: <CalendarDays className="h-4 w-4" />, label: 'marketing.referralDetailRegisteredDate', value: formatDate(referral.registered_at) },
    { icon: <CheckCircle2 className="h-4 w-4" />, label: 'marketing.referralDetailConvertedDate', value: formatDate(referral.converted_at) },
  ];

  return (
    <>
      {/* Status badges */}
      <div className="flex flex-wrap items-center gap-2">
        {statusBadge(referral.status)}
        {userStatusBadge(referral.referred_user_account_status)}
      </div>

      {/* Info rows */}
      <div className="space-y-3">
        {infoRows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-3">
            <span className="text-slate-400 dark:text-slate-500">{row.icon}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400 flex-1">{t(row.label as TranslationKey)}</span>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200 text-end">{row.value}</span>
          </div>
        ))}
      </div>

      {/* Commission summary */}
      {commissions.length > 0 && (
        <div className="rounded-lg bg-success-50 dark:bg-success-900/20 px-4 py-3">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-success-600 dark:text-success-400" />
            <span className="text-xs font-medium text-success-700 dark:text-success-400">{t('marketing.totalCommission')}</span>
            <span className="ms-auto text-lg font-bold text-success-700 dark:text-success-400">
              {totalCommission.toFixed(2)} {currency}
            </span>
          </div>
        </div>
      )}

      {/* Related Orders */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <ShoppingBag className="h-4 w-4" />
          {t('marketing.referralDetailRelatedOrders')}
        </div>
        {commissions.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500 ps-6">{t('marketing.referralDetailNoOrders')}</p>
        ) : (
          <div className="space-y-1.5 ps-6">
            {commissions.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-700/50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('marketing.colOrder')}: {c.order_id.slice(0, 8)}…
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {formatDate(c.created_at)}
                  </p>
                </div>
                <div className="text-end">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {c.gross_order_amount.toFixed(2)} {c.currency}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Related Commissions */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <TrendingUp className="h-4 w-4" />
          {t('marketing.referralDetailRelatedCommissions')}
        </div>
        {commissions.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500 ps-6">{t('marketing.referralDetailNoCommissions')}</p>
        ) : (
          <div className="space-y-1.5 ps-6">
            {commissions.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-700/50 px-3 py-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {c.commission_amount.toFixed(2)} {c.currency}
                  </p>
                  <div className="flex items-center gap-2">
                    {commissionStatusBadge(c.status)}
                    <span className="text-xs text-slate-400 dark:text-slate-500">{formatDate(c.created_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
