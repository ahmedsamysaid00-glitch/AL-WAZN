import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { MarketingLayout } from './MarketingLayout';
import {
  UserCheck,
  TrendingUp,
  Activity,
  Eye,
  UserPlus,
  ArrowUpRight,
  ArrowDownRight,
  CalendarDays,
  Link2,
  Copy,
  Check,
  Share2,
  BarChart3,
  DollarSign,
  Wallet,
  ChevronRight,
} from 'lucide-react';
import type { MarketingSettings, ReferralStatus, CommissionStatus } from '@/types/database';
import type { TranslationKey } from '@/i18n/translations';

interface AnalyticsKPIs {
  total_referrals: number;
  registered: number;
  converted: number;
  not_converted: number;
  expired: number;
  conversion_rate: number;
  period_referrals: number;
  period_registrations: number;
  period_conversions: number;
}

interface CommissionCurrencySummary {
  total: number;
  pending: number;
  approved: number;
  paid: number;
  reversed: number;
  cancelled: number;
  count: number;
}

interface TimeseriesPoint {
  date: string;
  referrals: number;
  registrations: number;
  conversions: number;
}

interface AnalyticsData {
  kpis: AnalyticsKPIs;
  commission_summary: Record<string, CommissionCurrencySummary>;
  referral_timeseries: TimeseriesPoint[];
  date_range: { start: string; end: string };
}

interface PayoutSummaryRow {
  currency: string;
  total_paid: number;
  total_pending: number;
  available_balance: number;
}

interface ReferralRow {
  id: string;
  status: ReferralStatus;
  created_at: string;
  registered_at: string | null;
  referred_user_full_name: string | null;
  total_count: number;
}

interface CommissionRow {
  id: string;
  commission_amount: number;
  currency: string;
  status: CommissionStatus;
  created_at: string;
  order_id: string;
  total_count: number;
}

interface PayoutRow {
  id: string;
  amount: number;
  currency: string;
  status: string;
  payout_method: string | null;
  created_at: string;
  total_count: number;
}

type PeriodDays = 7 | 30 | 90;

export function MarketingDashboard() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<MarketingSettings | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [payoutSummary, setPayoutSummary] = useState<PayoutSummaryRow[]>([]);
  const [recentReferrals, setRecentReferrals] = useState<ReferralRow[]>([]);
  const [recentCommissions, setRecentCommissions] = useState<CommissionRow[]>([]);
  const [recentPayouts, setRecentPayouts] = useState<PayoutRow[]>([]);

  const [analyticsError, setAnalyticsError] = useState(false);
  const [payoutError, setPayoutError] = useState(false);
  const [referralsError, setReferralsError] = useState(false);
  const [commissionsError, setCommissionsError] = useState(false);
  const [payoutsListError, setPayoutsListError] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<PeriodDays>(30);
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const periodDates = useMemo(() => {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - (period - 1));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }, [period]);

  const fetchAll = useCallback(async (isInitial: boolean) => {
    if (isInitial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    const results = await Promise.allSettled([
      supabase.from('marketing_settings').select('*').limit(1).maybeSingle(),
      supabase.rpc('get_marketer_analytics', {
        p_start_date: periodDates.start,
        p_end_date: periodDates.end,
      }),
      supabase.rpc('get_marketer_payouts_summary'),
      supabase.rpc('get_marketer_referrals', { p_limit: 5, p_offset: 0 }),
      supabase.rpc('get_marketer_commissions', { p_limit: 5, p_offset: 0 }),
      supabase.rpc('get_marketer_payouts', { p_limit: 5, p_offset: 0 }),
    ]);

    const [settingsRes, analyticsRes, payoutSummaryRes, referralsRes, commissionsRes, payoutsRes] = results;

    if (settingsRes.status === 'fulfilled' && settingsRes.value.data) {
      setSettings(settingsRes.value.data as MarketingSettings);
    }

    if (analyticsRes.status === 'fulfilled' && !analyticsRes.value.error && analyticsRes.value.data) {
      setAnalytics(analyticsRes.value.data as AnalyticsData);
      setAnalyticsError(false);
    } else {
      setAnalyticsError(true);
    }

    if (payoutSummaryRes.status === 'fulfilled' && !payoutSummaryRes.value.error && payoutSummaryRes.value.data) {
      setPayoutSummary(payoutSummaryRes.value.data as PayoutSummaryRow[]);
      setPayoutError(false);
    } else {
      setPayoutError(true);
    }

    if (referralsRes.status === 'fulfilled' && !referralsRes.value.error && referralsRes.value.data) {
      setRecentReferrals(referralsRes.value.data as ReferralRow[]);
      setReferralsError(false);
    } else {
      setReferralsError(true);
    }

    if (commissionsRes.status === 'fulfilled' && !commissionsRes.value.error && commissionsRes.value.data) {
      setRecentCommissions(commissionsRes.value.data as CommissionRow[]);
      setCommissionsError(false);
    } else {
      setCommissionsError(true);
    }

    if (payoutsRes.status === 'fulfilled' && !payoutsRes.value.error && payoutsRes.value.data) {
      setRecentPayouts(payoutsRes.value.data as PayoutRow[]);
      setPayoutsListError(false);
    } else {
      setPayoutsListError(true);
    }

    if (isInitial) {
      setLoading(false);
    } else {
      setRefreshing(false);
    }
  }, [periodDates.start, periodDates.end]);

  useEffect(() => {
    fetchAll(true);
  }, [fetchAll]);

  useRealtimeRefresh(
    [
      { table: 'marketing_referrals', filter: `marketer_id=eq.${profile?.id ?? ''}` },
      { table: 'marketing_commissions', filter: `marketer_id=eq.${profile?.id ?? ''}` },
      { table: 'marketing_payouts', filter: `marketer_id=eq.${profile?.id ?? ''}` },
      { table: 'marketing_settings' },
    ],
    () => fetchAll(false),
    !!profile?.id,
  );

  const referralLink = settings?.referral_code
    ? `${window.location.origin}/?ref=${settings.referral_code}`
    : '';

  const handleCopyLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const handleCopyCode = async () => {
    if (!settings?.referral_code) return;
    try {
      await navigator.clipboard.writeText(settings.referral_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const handleShare = async () => {
    if (!referralLink) return;
    if (navigator.share) {
      try { await navigator.share({ title: t('marketing.title'), url: referralLink }); } catch { /* cancelled */ }
    } else {
      handleCopyLink();
    }
  };

  const kpis = analytics?.kpis;
  const commissionCurrencies = useMemo(() => {
    if (!analytics?.commission_summary) return [];
    return Object.keys(analytics.commission_summary).sort();
  }, [analytics]);

  const maxChartValue = useMemo(() => {
    if (!analytics?.referral_timeseries) return 1;
    return Math.max(1, ...analytics.referral_timeseries.map((p) => Math.max(p.referrals, p.registrations, p.conversions)));
  }, [analytics]);

  const hasChartActivity = useMemo(() => {
    if (!analytics?.referral_timeseries) return false;
    return analytics.referral_timeseries.some((p) => p.referrals > 0 || p.registrations > 0 || p.conversions > 0);
  }, [analytics]);

  const periodLabels: Record<PeriodDays, string> = {
    7: t('marketing.period7Days'),
    30: t('marketing.period30Days'),
    90: t('marketing.period90Days'),
  };

  const statusBadgeClass = (status: CommissionStatus) => {
    switch (status) {
      case 'pending': return 'bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400';
      case 'approved': return 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400';
      case 'paid': return 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400';
      case 'reversed': return 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400';
      case 'cancelled': return 'bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400';
    }
  };

  const payoutStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400',
      completed: 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400',
      cancelled: 'bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400',
    };
    const labelKeys: Record<string, TranslationKey> = {
      pending: 'marketing.payoutsStatusPending',
      completed: 'marketing.payoutsStatusCompleted',
      cancelled: 'marketing.payoutsStatusCancelled',
    };
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${styles[status] ?? styles.pending}`}>
        {t(labelKeys[status] ?? 'marketing.payoutsStatusPending')}
      </span>
    );
  };

  const referralStatusBadge = (status: ReferralStatus) => {
    const styles: Record<string, string> = {
      attributed: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
      registered: 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400',
      converted: 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400',
      expired: 'bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400',
    };
    return (
      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${styles[status] ?? styles.attributed}`}>
        {t(`marketing.status.${status}` as TranslationKey)}
      </span>
    );
  };

  const quickActions = [
    { label: t('marketing.referralsTitle'), icon: <UserPlus className="h-4 w-4" />, to: '/marketing/referrals' },
    { label: t('marketing.analyticsTitle'), icon: <BarChart3 className="h-4 w-4" />, to: '/marketing/analytics' },
    { label: t('marketing.toolsTitle'), icon: <TrendingUp className="h-4 w-4" />, to: '/marketing/tools' },
    { label: t('marketing.commissionsTitle'), icon: <DollarSign className="h-4 w-4" />, to: '/marketing/commissions' },
    { label: t('marketing.payoutsTitle'), icon: <Wallet className="h-4 w-4" />, to: '/marketing/payouts' },
  ];

  if (loading) {
    return (
      <MarketingLayout>
        <LoadingState label={t('marketing.loadingDashboard')} />
      </MarketingLayout>
    );
  }

  return (
    <MarketingLayout>
      <div className="space-y-6">
        {/* Welcome Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('marketing.welcome')}, {profile?.full_name ?? t('marketing.marketer')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('marketing.overviewSubtitle')}</p>
        </div>

        {/* Referral Link & Code Card */}
        {settings?.referral_code && (
          <div className="card p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                    <Link2 className="h-4 w-4" />
                    {t('marketing.referralLink')}
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-100 dark:bg-slate-700 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300" dir="ltr">
                      {referralLink}
                    </code>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t('marketing.referralLinkHint')}</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {t('marketing.referralCode')}
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="rounded-lg bg-primary-50 dark:bg-primary-900/20 px-3 py-1.5 text-sm font-mono font-semibold text-primary-700 dark:text-primary-400" dir="ltr">
                      {settings.referral_code}
                    </code>
                    <button onClick={handleCopyCode} className="btn-ghost btn-sm" aria-label={t('marketing.copyCode')}>
                      {copiedCode ? <Check className="h-4 w-4 text-success-600" /> : <Copy className="h-4 w-4" />}
                      {copiedCode ? t('marketing.copied') : t('marketing.copyCode')}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleCopyLink} className="btn-secondary btn-sm">
                  {copied ? <Check className="h-4 w-4 text-success-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? t('marketing.copied') : t('marketing.copyLink')}
                </button>
                <button onClick={handleShare} className="btn-ghost btn-sm">
                  <Share2 className="h-4 w-4" />
                  {t('marketing.shareLink')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <button
              key={action.to}
              onClick={() => navigate(action.to)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-200 dark:hover:bg-slate-600"
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>

        {/* KPI Cards */}
        {analyticsError ? (
          <div className="card">
            <ErrorState message={t('marketing.dashKpiError')} onRetry={() => fetchAll(false)} retryLabel={t('common.retry')} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard
              label={t('marketing.totalVisitors')}
              value={kpis?.total_referrals ?? 0}
              sub={`${kpis?.period_referrals ?? 0} ${t('marketing.thisPeriod')}`}
              icon={<Eye className="h-5 w-5" />}
              color="text-primary-600 dark:text-primary-400"
            />
            <KpiCard
              label={t('marketing.registeredUsers')}
              value={kpis?.registered ?? 0}
              sub={`${kpis?.period_registrations ?? 0} ${t('marketing.thisPeriod')}`}
              icon={<UserPlus className="h-5 w-5" />}
              color="text-accent-600 dark:text-accent-400"
            />
            <KpiCard
              label={t('marketing.convertedUsers')}
              value={kpis?.converted ?? 0}
              sub={`${kpis?.period_conversions ?? 0} ${t('marketing.thisPeriod')}`}
              icon={<UserCheck className="h-5 w-5" />}
              color="text-success-600 dark:text-success-400"
            />
            <KpiCard
              label={t('marketing.conversionRate')}
              value={`${kpis?.conversion_rate ?? 0}%`}
              icon={<TrendingUp className="h-5 w-5" />}
              color="text-success-600 dark:text-success-400"
            />
            <KpiCard
              label={t('marketing.activeReferrals')}
              value={(kpis?.registered ?? 0) - (kpis?.converted ?? 0) + (kpis?.not_converted ?? 0)}
              icon={<Activity className="h-5 w-5" />}
              color="text-primary-600 dark:text-primary-400"
            />
            <KpiCard
              label={t('marketing.dashExpired')}
              value={kpis?.expired ?? 0}
              icon={<CalendarDays className="h-5 w-5" />}
              color="text-error-600 dark:text-error-400"
            />
          </div>
        )}

        {/* Commission + Payout Summary (per currency) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Commission Summary */}
          <div className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('marketing.dashCommissionOverview')}</h2>
              <button
                onClick={() => navigate('/marketing/commissions')}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
              >
                {t('marketing.dashViewAll')}
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            {analyticsError ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">{t('marketing.dashKpiError')}</p>
            ) : commissionCurrencies.length === 0 ? (
              <EmptyState icon={<DollarSign className="h-8 w-8" />} title={t('marketing.noCommissions')} />
            ) : (
              <div className="space-y-4">
                {commissionCurrencies.map((currency) => {
                  const cs = analytics!.commission_summary[currency];
                  return (
                    <div key={currency}>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{currency}</span>
                        <span className="text-xs text-slate-400">({cs.count})</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <SummaryMini label={t('marketing.totalCommission')} value={cs.total.toFixed(2)} color="text-success-600 dark:text-success-400" />
                        <SummaryMini label={t('marketing.pendingCommission')} value={cs.pending.toFixed(2)} color="text-warning-600 dark:text-warning-400" />
                        <SummaryMini label={t('marketing.approvedCommission')} value={cs.approved.toFixed(2)} color="text-primary-600 dark:text-primary-400" />
                        <SummaryMini label={t('marketing.paidCommission')} value={cs.paid.toFixed(2)} color="text-success-600 dark:text-success-400" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Payout Summary */}
          <div className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('marketing.dashPayoutOverview')}</h2>
              <button
                onClick={() => navigate('/marketing/payouts')}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
              >
                {t('marketing.dashViewAll')}
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            {payoutError ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">{t('marketing.payoutsFailed')}</p>
            ) : payoutSummary.length === 0 ? (
              <EmptyState icon={<Wallet className="h-8 w-8" />} title={t('marketing.noPayouts')} />
            ) : (
              <div className="space-y-4">
                {payoutSummary.map((s) => (
                  <div key={s.currency}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{s.currency}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <SummaryMini label={t('marketing.payoutsAvailable')} value={s.available_balance.toFixed(2)} color="text-success-600 dark:text-success-400" />
                      <SummaryMini label={t('marketing.payoutsPendingAmount')} value={s.total_pending.toFixed(2)} color="text-warning-600 dark:text-warning-400" />
                      <SummaryMini label={t('marketing.payoutsPaidAmount')} value={s.total_paid.toFixed(2)} color="text-primary-600 dark:text-primary-400" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Growth Chart */}
        <div className="card p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-slate-400 dark:text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('marketing.userGrowthChart')}</h2>
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-700 p-1">
              {([7, 30, 90] as PeriodDays[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    period === p
                      ? 'bg-white dark:bg-slate-800 text-primary-700 dark:text-primary-300 shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  {periodLabels[p]}
                </button>
              ))}
            </div>
          </div>

          {/* Growth summary */}
          <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-primary-500" />
                <span className="text-slate-600 dark:text-slate-400">{t('marketing.newVisitors')}</span>
              </span>
              <span className="font-semibold text-slate-900 dark:text-white">{kpis?.period_referrals ?? 0}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-accent-500" />
                <span className="text-slate-600 dark:text-slate-400">{t('marketing.newRegistrations')}</span>
              </span>
              <span className="font-semibold text-slate-900 dark:text-white">{kpis?.period_registrations ?? 0}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-success-500" />
                <span className="text-slate-600 dark:text-slate-400">{t('marketing.conversions')}</span>
              </span>
              <span className="font-semibold text-slate-900 dark:text-white">{kpis?.period_conversions ?? 0}</span>
            </div>
          </div>

          {/* Chart */}
          {!hasChartActivity ? (
            <EmptyState icon={<CalendarDays className="h-8 w-8" />} title={t('marketing.noActivity')} />
          ) : (
            <div className="flex items-end gap-1 h-40" dir="ltr">
              {analytics?.referral_timeseries?.map((bucket) => (
                <div key={bucket.date} className="flex-1 flex flex-col items-center gap-1 group min-w-0">
                  <div className="relative w-full flex items-end justify-center gap-0.5" style={{ height: '100%' }}>
                    <div
                      className="w-1/3 max-w-[1rem] rounded-t-sm bg-primary-500/70 dark:bg-primary-400/70 transition-all group-hover:bg-primary-600 dark:group-hover:bg-primary-300"
                      style={{ height: `${(bucket.referrals / maxChartValue) * 100}%`, minHeight: bucket.referrals > 0 ? '4px' : '0' }}
                      title={`${bucket.date}: ${bucket.referrals}`}
                    />
                    <div
                      className="w-1/3 max-w-[1rem] rounded-t-sm bg-accent-500/70 dark:bg-accent-400/70 transition-all group-hover:bg-accent-600 dark:group-hover:bg-accent-300"
                      style={{ height: `${(bucket.registrations / maxChartValue) * 100}%`, minHeight: bucket.registrations > 0 ? '4px' : '0' }}
                      title={`${bucket.date}: ${bucket.registrations}`}
                    />
                    <div
                      className="w-1/3 max-w-[1rem] rounded-t-sm bg-success-500/70 dark:bg-success-400/70 transition-all group-hover:bg-success-600 dark:group-hover:bg-success-300"
                      style={{ height: `${(bucket.conversions / maxChartValue) * 100}%`, minHeight: bucket.conversions > 0 ? '4px' : '0' }}
                      title={`${bucket.date}: ${bucket.conversions}`}
                    />
                  </div>
                  {period <= 30 && (
                    <span className="text-[0.6rem] text-slate-400 dark:text-slate-500 truncate w-full text-center">
                      {bucket.date.slice(5)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {period > 30 && (
            <p className="mt-2 text-center text-xs text-slate-400 dark:text-slate-500">{t('marketing.chartHintLongPeriod')}</p>
          )}
        </div>

        {/* Recent Activity — three columns on desktop */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Recent Referrals */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('marketing.dashRecentReferrals')}</h2>
              <button
                onClick={() => navigate('/marketing/referrals')}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
              >
                {t('marketing.dashViewAll')}
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            {referralsError ? (
              <div className="px-4 py-6"><ErrorState message={t('marketing.failedLoad')} onRetry={() => fetchAll(false)} retryLabel={t('common.retry')} /></div>
            ) : recentReferrals.length === 0 ? (
              <div className="px-4 py-6"><EmptyState icon={<UserPlus className="h-8 w-8" />} title={t('marketing.noReferrals')} /></div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {recentReferrals.map((r) => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                        {r.referred_user_full_name ?? t('marketing.anonymousUser')}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        {new Date(r.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    {referralStatusBadge(r.status)}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Commissions */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('marketing.dashRecentCommissions')}</h2>
              <button
                onClick={() => navigate('/marketing/commissions')}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
              >
                {t('marketing.dashViewAll')}
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            {commissionsError ? (
              <div className="px-4 py-6"><ErrorState message={t('marketing.failedLoad')} onRetry={() => fetchAll(false)} retryLabel={t('common.retry')} /></div>
            ) : recentCommissions.length === 0 ? (
              <div className="px-4 py-6"><EmptyState icon={<DollarSign className="h-8 w-8" />} title={t('marketing.noCommissions')} /></div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {recentCommissions.map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {c.commission_amount.toFixed(2)} {c.currency}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        {new Date(c.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClass(c.status)}`}>
                      {t(`marketing.status.${c.status}` as TranslationKey)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Payouts */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('marketing.dashRecentPayouts')}</h2>
              <button
                onClick={() => navigate('/marketing/payouts')}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
              >
                {t('marketing.dashViewAll')}
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            {payoutsListError ? (
              <div className="px-4 py-6"><ErrorState message={t('marketing.failedLoad')} onRetry={() => fetchAll(false)} retryLabel={t('common.retry')} /></div>
            ) : recentPayouts.length === 0 ? (
              <div className="px-4 py-6"><EmptyState icon={<Wallet className="h-8 w-8" />} title={t('marketing.noPayouts')} /></div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {recentPayouts.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {p.amount.toFixed(2)} {p.currency}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        {new Date(p.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    {payoutStatusBadge(p.status)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {refreshing && (
          <p className="text-center text-xs text-slate-400 dark:text-slate-500 animate-pulse">{t('marketing.dashRefreshing')}</p>
        )}
      </div>
    </MarketingLayout>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon,
  color,
  growthDir,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color: string;
  growthDir?: 'up' | 'down' | 'flat';
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
        <span className={color}>{icon}</span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{value}</p>
      {sub && (
        <div className="mt-1 flex items-center gap-1 text-xs">
          {growthDir === 'up' && <ArrowUpRight className="h-3 w-3 text-success-500" />}
          {growthDir === 'down' && <ArrowDownRight className="h-3 w-3 text-error-500" />}
          <span className={growthDir === 'up' ? 'text-success-600 dark:text-success-400' : growthDir === 'down' ? 'text-error-600 dark:text-error-400' : 'text-slate-500 dark:text-slate-400'}>
            {sub}
          </span>
        </div>
      )}
    </div>
  );
}

function SummaryMini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm font-bold ${color}`}>{value}</p>
    </div>
  );
}
