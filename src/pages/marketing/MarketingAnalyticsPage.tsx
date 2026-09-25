import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { MarketingLayout } from './MarketingLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import {
  BarChart3,
  TrendingUp,
  UserPlus,
  UserCheck,
  Users,
  DollarSign,
  Wallet,
  CalendarDays,
  Activity,
  ArrowDownRight,
  Info,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';

type TimeRangePreset = '7d' | '30d' | '90d' | 'custom';

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

interface CommissionTimeseriesPoint {
  date: string;
  amount: number;
  currency: string;
}

interface AnalyticsData {
  kpis: AnalyticsKPIs;
  commission_summary: Record<string, CommissionCurrencySummary>;
  referral_timeseries: TimeseriesPoint[];
  commission_timeseries: CommissionTimeseriesPoint[];
  date_range: { start: string; end: string };
}

const PRESETS: { value: TimeRangePreset; labelKey: TranslationKey }[] = [
  { value: '7d', labelKey: 'marketing.analyticsRange7' },
  { value: '30d', labelKey: 'marketing.analyticsRange30' },
  { value: '90d', labelKey: 'marketing.analyticsRange90' },
  { value: 'custom', labelKey: 'marketing.analyticsRangeCustom' },
];

function presetToDates(preset: TimeRangePreset): { start: string; end: string } {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  switch (preset) {
    case '7d': start.setDate(start.getDate() - 6); break;
    case '30d': start.setDate(start.getDate() - 29); break;
    case '90d': start.setDate(start.getDate() - 89); break;
    case 'custom': start.setDate(start.getDate() - 29); break;
  }
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function MarketingAnalyticsPage() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const marketerId = profile?.id ?? '';

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [preset, setPreset] = useState<TimeRangePreset>('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { start, end } = useMemo(() => {
    if (preset === 'custom' && customStart && customEnd) {
      return { start: customStart, end: customEnd };
    }
    return presetToDates(preset);
  }, [preset, customStart, customEnd]);

  const fetchAnalytics = useCallback(async (isInitial: boolean) => {
    if (isInitial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(false);

    const { data: raw, error: err } = await supabase.rpc('get_marketer_analytics', {
      p_start_date: start,
      p_end_date: end,
    });

    if (err || !raw) {
      setError(true);
      setData(null);
    } else {
      setData(raw as AnalyticsData);
    }

    if (isInitial) {
      setLoading(false);
    } else {
      setRefreshing(false);
    }
  }, [start, end]);

  useEffect(() => {
    fetchAnalytics(true);
  }, [fetchAnalytics]);

  useRealtimeRefresh(
    [
      { table: 'marketing_referrals', filter: `marketer_id=eq.${marketerId}` },
      { table: 'marketing_commissions', filter: `marketer_id=eq.${marketerId}` },
    ],
    () => fetchAnalytics(false),
    !!marketerId,
  );

  const currencies = useMemo(() => {
    if (!data?.commission_summary) return [];
    return Object.keys(data.commission_summary).sort();
  }, [data]);

  const maxChartValue = useMemo(() => {
    if (!data?.referral_timeseries) return 1;
    return Math.max(1, ...data.referral_timeseries.map((p) => Math.max(p.referrals, p.registrations, p.conversions)));
  }, [data]);

  const maxCommissionValue = useMemo(() => {
    if (!data?.commission_timeseries) return 1;
    return Math.max(1, ...data.commission_timeseries.map((p) => p.amount));
  }, [data]);

  const hasReferralActivity = useMemo(() => {
    if (!data?.referral_timeseries) return false;
    return data.referral_timeseries.some((p) => p.referrals > 0 || p.registrations > 0 || p.conversions > 0);
  }, [data]);

  const hasCommissionActivity = useMemo(() => {
    if (!data?.commission_timeseries) return false;
    return data.commission_timeseries.some((p) => p.amount > 0);
  }, [data]);

  if (loading) {
    return (
      <MarketingLayout>
        <LoadingState label={t('marketing.analyticsLoading')} />
      </MarketingLayout>
    );
  }

  if (error) {
    return (
      <MarketingLayout>
        <ErrorState message={t('marketing.analyticsFailed')} onRetry={() => fetchAnalytics(true)} retryLabel={t('common.retry')} />
      </MarketingLayout>
    );
  }

  const kpis = data?.kpis;
  const showEmpty = kpis?.total_referrals === 0 && currencies.length === 0;

  return (
    <MarketingLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('marketing.analyticsTitle')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('marketing.analyticsSubtitle')}</p>
        </div>

        {/* Time Range Controls */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPreset(opt.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  preset === opt.value
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 focus:border-primary-500 focus:outline-none"
              />
              <span className="text-xs text-slate-400">—</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 focus:border-primary-500 focus:outline-none"
              />
            </div>
          )}
          {refreshing && (
            <span className="text-xs text-slate-400 dark:text-slate-500 animate-pulse">{t('marketing.analyticsRefreshing')}</span>
          )}
        </div>

        {showEmpty ? (
          <div className="card">
            <EmptyState
              icon={<BarChart3 className="h-8 w-8" />}
              title={t('marketing.analyticsEmpty')}
              description={t('marketing.analyticsEmptyDesc')}
            />
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <KpiCard
                label={t('marketing.analyticsTotalReferrals')}
                value={kpis?.total_referrals ?? 0}
                sub={`${kpis?.period_referrals ?? 0} ${t('marketing.analyticsThisPeriod')}`}
                icon={<Users className="h-5 w-5" />}
                color="text-primary-600 dark:text-primary-400"
              />
              <KpiCard
                label={t('marketing.analyticsRegistered')}
                value={kpis?.registered ?? 0}
                sub={`${kpis?.period_registrations ?? 0} ${t('marketing.analyticsThisPeriod')}`}
                icon={<UserPlus className="h-5 w-5" />}
                color="text-accent-600 dark:text-accent-400"
              />
              <KpiCard
                label={t('marketing.analyticsConverted')}
                value={kpis?.converted ?? 0}
                sub={`${kpis?.period_conversions ?? 0} ${t('marketing.analyticsThisPeriod')}`}
                icon={<UserCheck className="h-5 w-5" />}
                color="text-success-600 dark:text-success-400"
              />
              <KpiCard
                label={t('marketing.analyticsNotConverted')}
                value={kpis?.not_converted ?? 0}
                icon={<Activity className="h-5 w-5" />}
                color="text-slate-500 dark:text-slate-400"
              />
              <KpiCard
                label={t('marketing.analyticsConversionRate')}
                value={`${kpis?.conversion_rate ?? 0}%`}
                icon={<TrendingUp className="h-5 w-5" />}
                color="text-success-600 dark:text-success-400"
              />
              <KpiCard
                label={t('marketing.analyticsExpired')}
                value={kpis?.expired ?? 0}
                icon={<CalendarDays className="h-5 w-5" />}
                color="text-error-600 dark:text-error-400"
              />
            </div>

            {/* Commission Summary Cards (per currency) */}
            {currencies.length > 0 && (
              <div className="space-y-3">
                {currencies.map((currency) => {
                  const cs = data!.commission_summary[currency];
                  return (
                    <div key={currency} className="card p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                          {t('marketing.analyticsCommissionSummary')} ({currency})
                        </h3>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        <CommissionCard label={t('marketing.analyticsTotalCommission')} value={cs.total} currency={currency} icon={<DollarSign className="h-4 w-4" />} color="text-success-600 dark:text-success-400" />
                        <CommissionCard label={t('marketing.analyticsPendingCommission')} value={cs.pending} currency={currency} icon={<Wallet className="h-4 w-4" />} color="text-warning-600 dark:text-warning-400" />
                        <CommissionCard label={t('marketing.analyticsApprovedCommission')} value={cs.approved} currency={currency} icon={<TrendingUp className="h-4 w-4" />} color="text-primary-600 dark:text-primary-400" />
                        <CommissionCard label={t('marketing.analyticsPaidCommission')} value={cs.paid} currency={currency} icon={<UserCheck className="h-4 w-4" />} color="text-success-600 dark:text-success-400" />
                        <CommissionCard label={t('marketing.analyticsReversedCommission')} value={cs.reversed} currency={currency} icon={<ArrowDownRight className="h-4 w-4" />} color="text-slate-500 dark:text-slate-400" />
                        <CommissionCard label={t('marketing.analyticsCancelledCommission')} value={cs.cancelled} currency={currency} icon={<ArrowDownRight className="h-4 w-4" />} color="text-error-600 dark:text-error-400" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Traffic/Referral Activity — Not Available Notice */}
            <div className="card p-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 shrink-0 text-slate-400 dark:text-slate-500 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('marketing.analyticsTrafficTitle')}</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('marketing.analyticsTrafficUnavailable')}</p>
                </div>
              </div>
            </div>

            {/* Referral Activity Chart */}
            <div className="card p-5">
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('marketing.analyticsReferralActivityChart')}</h2>
              </div>
              {hasReferralActivity ? (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
                    <ChartLegend color="bg-primary-500" label={t('marketing.analyticsChartReferrals')} value={kpis?.period_referrals ?? 0} />
                    <ChartLegend color="bg-accent-500" label={t('marketing.analyticsChartRegistrations')} value={kpis?.period_registrations ?? 0} />
                    <ChartLegend color="bg-success-500" label={t('marketing.analyticsChartConversions')} value={kpis?.period_conversions ?? 0} />
                  </div>
                  <div className="flex items-end gap-1 h-40" dir="ltr">
                    {data?.referral_timeseries?.map((point) => (
                      <div key={point.date} className="flex-1 flex flex-col items-center gap-1 group min-w-0">
                        <div className="relative w-full flex items-end justify-center gap-0.5" style={{ height: '100%' }}>
                          <div
                            className="w-1/3 max-w-[1rem] rounded-t-sm bg-primary-500/70 dark:bg-primary-400/70 transition-all group-hover:bg-primary-600 dark:group-hover:bg-primary-300"
                            style={{ height: `${(point.referrals / maxChartValue) * 100}%`, minHeight: point.referrals > 0 ? '4px' : '0' }}
                            title={`${point.date}: ${point.referrals}`}
                          />
                          <div
                            className="w-1/3 max-w-[1rem] rounded-t-sm bg-accent-500/70 dark:bg-accent-400/70 transition-all group-hover:bg-accent-600 dark:group-hover:bg-accent-300"
                            style={{ height: `${(point.registrations / maxChartValue) * 100}%`, minHeight: point.registrations > 0 ? '4px' : '0' }}
                            title={`${point.date}: ${point.registrations}`}
                          />
                          <div
                            className="w-1/3 max-w-[1rem] rounded-t-sm bg-success-500/70 dark:bg-success-400/70 transition-all group-hover:bg-success-600 dark:group-hover:bg-success-300"
                            style={{ height: `${(point.conversions / maxChartValue) * 100}%`, minHeight: point.conversions > 0 ? '4px' : '0' }}
                            title={`${point.date}: ${point.conversions}`}
                          />
                        </div>
                        {data.referral_timeseries.length <= 30 && (
                          <span className="text-[0.6rem] text-slate-400 dark:text-slate-500 truncate w-full text-center">
                            {point.date.slice(5)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {data && data.referral_timeseries.length > 30 && (
                    <p className="mt-2 text-center text-xs text-slate-400 dark:text-slate-500">{t('marketing.analyticsChartHintLong')}</p>
                  )}
                </>
              ) : (
                <EmptyState icon={<CalendarDays className="h-8 w-8" />} title={t('marketing.analyticsNoReferralActivity')} />
              )}
            </div>

            {/* Commission Chart */}
            <div className="card p-5">
              <div className="mb-4 flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('marketing.analyticsCommissionChart')}</h2>
              </div>
              {hasCommissionActivity ? (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
                    <ChartLegend color="bg-success-500" label={t('marketing.analyticsChartCommission')} value={data?.commission_timeseries?.reduce((s, p) => s + p.amount, 0) ?? 0} />
                  </div>
                  <div className="flex items-end gap-1 h-40" dir="ltr">
                    {data?.commission_timeseries?.map((point) => (
                      <div key={point.date} className="flex-1 flex flex-col items-center gap-1 group min-w-0">
                        <div className="relative w-full flex items-end justify-center" style={{ height: '100%' }}>
                          <div
                            className="w-1/2 max-w-[1.5rem] rounded-t-sm bg-success-500/70 dark:bg-success-400/70 transition-all group-hover:bg-success-600 dark:group-hover:bg-success-300"
                            style={{ height: `${(point.amount / maxCommissionValue) * 100}%`, minHeight: point.amount > 0 ? '4px' : '0' }}
                            title={`${point.date}: ${point.amount.toFixed(2)} ${point.currency}`}
                          />
                        </div>
                        {data.commission_timeseries.length <= 30 && (
                          <span className="text-[0.6rem] text-slate-400 dark:text-slate-500 truncate w-full text-center">
                            {point.date.slice(5)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {data && data.commission_timeseries.length > 30 && (
                    <p className="mt-2 text-center text-xs text-slate-400 dark:text-slate-500">{t('marketing.analyticsChartHintLong')}</p>
                  )}
                </>
              ) : (
                <EmptyState icon={<DollarSign className="h-8 w-8" />} title={t('marketing.analyticsNoCommissionActivity')} />
              )}
            </div>
          </>
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
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
        <span className={color}>{icon}</span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{value}</p>
      {sub && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p>
      )}
    </div>
  );
}

function CommissionCard({
  label,
  value,
  currency,
  icon,
  color,
}: {
  label: string;
  value: number;
  currency: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-700/50 p-3">
      <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500">
        <span className={color}>{icon}</span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-1.5 text-sm font-bold text-slate-900 dark:text-white">
        {value.toFixed(2)} <span className="text-xs text-slate-400 dark:text-slate-500">{currency}</span>
      </p>
    </div>
  );
}

function ChartLegend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5">
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
        <span className="text-slate-600 dark:text-slate-400">{label}</span>
      </span>
      <span className="font-semibold text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}
