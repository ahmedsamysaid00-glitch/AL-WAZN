import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/i18n/useLanguage';
import { supabase } from '@/lib/supabase';
import { ErrorState, EmptyState } from '@/components/ui/States';
import { Skeleton } from '@/components/ui/Skeleton';
import { AdminLayout } from './AdminLayout';
import type { TranslationKey } from '@/i18n/translations';
import type { FeedbackCategory, FeedbackStatus, FeedbackUserType } from '@/types/database';
import {
  BarChart3, Star, ThumbsUp, Lightbulb, ShieldAlert, Clock,
  CheckCircle2, ArrowLeft, RefreshCw, TrendingUp, Users,
} from 'lucide-react';
import type { ReactNode } from 'react';

// ============================================================
// Types
// ============================================================

interface AnalyticsSummary {
  avg_rating: number | null;
  total_rated: number;
  total_feedback: number;
  new_count: number;
  resolved_count: number;
  resolution_rate: number | null;
  public_suggestions_count: number;
  implemented_suggestions_count: number;
  security_reports_count: number;
}

interface RatingDistRow {
  rating: number;
  count: number;
}

interface CategoryStatRow {
  category: FeedbackCategory;
  feedback_count: number;
  percentage: number | null;
  avg_rating: number | null;
}

interface RoleStatRow {
  user_type: FeedbackUserType;
  total_feedback: number;
  avg_rating: number | null;
  rated_count: number;
}

interface SatisfactionRow {
  bucket: string;
  avg_rating: number | null;
  rated_count: number;
}

interface TopIdeaRow {
  id: string;
  title: string;
  category: FeedbackCategory;
  vote_count: number;
  status: FeedbackStatus;
}

interface ImplementedRow {
  id: string;
  title: string;
  category: FeedbackCategory;
  vote_count: number;
  resolved_at: string;
}

interface SecurityAggregate {
  total: number;
  new_count: number;
  under_review_count: number;
  in_progress_count: number;
  resolved_count: number;
  closed_count: number;
  rejected_count: number;
}

type DateRange = '7d' | '30d' | '90d' | '12m' | 'all';

// ============================================================
// Constants
// ============================================================

const DATE_RANGES: { value: DateRange; labelKey: TranslationKey }[] = [
  { value: '7d', labelKey: 'admin.feedback.analyticsRange7d' },
  { value: '30d', labelKey: 'admin.feedback.analyticsRange30d' },
  { value: '90d', labelKey: 'admin.feedback.analyticsRange90d' },
  { value: '12m', labelKey: 'admin.feedback.analyticsRange12m' },
  { value: 'all', labelKey: 'admin.feedback.analyticsRangeAll' },
];

const RATING_BAR_COLORS = [
  'bg-error-400',
  'bg-warning-400',
  'bg-amber-400',
  'bg-lime-400',
  'bg-success-500',
];

const RATING_BAR_BG = [
  'bg-error-50 dark:bg-error-900/20',
  'bg-warning-50 dark:bg-warning-900/20',
  'bg-amber-50 dark:bg-amber-900/20',
  'bg-lime-50 dark:bg-lime-900/20',
  'bg-success-50 dark:bg-success-900/20',
];

// ============================================================
// Helpers
// ============================================================

function categoryLabelKey(category: FeedbackCategory): TranslationKey {
  const map: Record<FeedbackCategory, TranslationKey> = {
    new_feature: 'feedback.category.new_feature',
    improve_existing_feature: 'feedback.category.improve_existing_feature',
    design: 'feedback.category.design',
    traveler_experience: 'feedback.category.traveler_experience',
    sender_experience: 'feedback.category.sender_experience',
    communication: 'feedback.category.communication',
    safety_trust: 'feedback.category.safety_trust',
    identity_verification: 'feedback.category.identity_verification',
    tracking: 'feedback.category.tracking',
    payments: 'feedback.category.payments',
    notifications: 'feedback.category.notifications',
    other: 'feedback.category.other',
    registration: 'feedback.bug.category.registration',
    login: 'feedback.bug.category.login',
    account: 'feedback.bug.category.account',
    create_listing: 'feedback.bug.category.create_listing',
    search: 'feedback.bug.category.search',
    orders: 'feedback.bug.category.orders',
    messages: 'feedback.bug.category.messages',
    file_upload: 'feedback.bug.category.file_upload',
    technical_other: 'feedback.bug.category.technical_other',
    suspicious_account: 'feedback.security.category.suspicious_account',
    suspicious_listing: 'feedback.security.category.suspicious_listing',
    inappropriate_behavior: 'feedback.security.category.inappropriate_behavior',
    off_platform_contact: 'feedback.security.category.off_platform_contact',
    privacy_issue: 'feedback.security.category.privacy_issue',
    security_other: 'feedback.security.category.security_other',
  };
  return map[category];
}

function roleLabelKey(role: FeedbackUserType): TranslationKey {
  return role === 'traveler' ? 'admin.feedback.role.traveler' : 'admin.feedback.role.sender';
}

function formatNumber(n: number | null | undefined, lang: string): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US').format(n);
}

function formatPercent(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function formatRating(n: number | null | undefined, lang: string): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);
}

// ============================================================
// Sub-components
// ============================================================

function MetricCard({ icon, label, value, color }: { icon: ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          {icon}
        </div>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

function RatingBar({ rating, count, maxCount }: { rating: number; count: number; maxCount: number }) {
  const { t } = useLanguage();
  const width = maxCount > 0 ? (count / maxCount) * 100 : 0;
  const colorIdx = rating - 1;
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-16 shrink-0 items-center gap-1 text-sm font-medium text-slate-600 dark:text-slate-400">
        {rating} <Star className="h-3.5 w-3.5 fill-current text-amber-400" />
      </span>
      <div className={`relative h-7 flex-1 overflow-hidden rounded-lg ${RATING_BAR_BG[colorIdx]}`} role="img" aria-label={`${t(rating === 1 ? 'admin.feedback.analyticsStar' : 'admin.feedback.analyticsStars').replace('{count}', String(rating))}: ${count}`}>
        <div
          className={`h-full rounded-lg transition-all duration-500 ${RATING_BAR_COLORS[colorIdx]}`}
          style={{ width: `${width}%` }}
        />
        <span className="absolute inset-0 flex items-center px-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
          {count}
        </span>
      </div>
    </div>
  );
}

function SectionCard({ title, icon, children, loading, error, onRetry }: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-slate-500 dark:text-slate-400">{icon}</span>
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      ) : error ? (
        <ErrorState message={t('admin.feedback.analyticsError')} onRetry={onRetry} retryLabel={t('admin.feedback.analyticsRetry')} />
      ) : children}
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================

export function AdminFeedbackAnalytics() {
  const { t, dir, lang } = useLanguage();
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [refreshKey, setRefreshKey] = useState(0);

  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [ratingDist, setRatingDist] = useState<RatingDistRow[]>([]);
  const [categoryStats, setCategoryStats] = useState<CategoryStatRow[]>([]);
  const [roleStats, setRoleStats] = useState<RoleStatRow[]>([]);
  const [satisfaction, setSatisfaction] = useState<SatisfactionRow[]>([]);
  const [topIdeas, setTopIdeas] = useState<TopIdeaRow[]>([]);
  const [implemented, setImplemented] = useState<ImplementedRow[]>([]);
  const [securityAgg, setSecurityAgg] = useState<SecurityAggregate | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(false);

    const [sumRes, distRes, catRes, roleRes, satRes, ideasRes, implRes, secRes] = await Promise.all([
      supabase.rpc('get_feedback_analytics', { p_date_range: dateRange }),
      supabase.rpc('get_feedback_rating_distribution', { p_date_range: dateRange }),
      supabase.rpc('get_feedback_category_stats', { p_date_range: dateRange }),
      supabase.rpc('get_feedback_role_stats', { p_date_range: dateRange }),
      supabase.rpc('get_feedback_satisfaction_over_time', { p_date_range: dateRange }),
      supabase.rpc('get_feedback_top_ideas', { p_limit: 10 }),
      supabase.rpc('get_feedback_implemented_suggestions', { p_date_range: dateRange, p_limit: 10 }),
      supabase.rpc('get_feedback_security_aggregate', { p_date_range: dateRange }),
    ]);

    if (sumRes.error || distRes.error || catRes.error || roleRes.error || satRes.error || ideasRes.error || implRes.error || secRes.error) {
      setError(true);
    } else {
      setSummary((sumRes.data as unknown as AnalyticsSummary[])?.[0] ?? null);
      setRatingDist((distRes.data as unknown as RatingDistRow[]) ?? []);
      setCategoryStats((catRes.data as unknown as CategoryStatRow[]) ?? []);
      setRoleStats((roleRes.data as unknown as RoleStatRow[]) ?? []);
      setSatisfaction((satRes.data as unknown as SatisfactionRow[]) ?? []);
      setTopIdeas((ideasRes.data as unknown as TopIdeaRow[]) ?? []);
      setImplemented((implRes.data as unknown as ImplementedRow[]) ?? []);
      setSecurityAgg((secRes.data as unknown as SecurityAggregate[])?.[0] ?? null);
    }

    setLoading(false);
  }, [dateRange]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics, refreshKey]);

  const handleRefresh = () => setRefreshKey((k) => k + 1);

  const maxRatingCount = Math.max(...ratingDist.map((r) => r.count), 1);


  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('admin.feedback.analyticsTitle')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('admin.feedback.analyticsSubtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/admin/feedback" className="btn-ghost btn-sm">
              <ArrowLeft className={`h-4 w-4 ${dir === 'rtl' ? 'rotate-180' : ''}`} />
              {t('admin.feedback.backToFeedback')}
            </Link>
            <button onClick={handleRefresh} disabled={loading} className="btn-secondary btn-sm">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {t('admin.feedback.analyticsRefresh')}
            </button>
          </div>
        </div>

        {/* Date range selector */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('admin.feedback.analyticsDateRange')}:</span>
          {DATE_RANGES.map((dr) => (
            <button
              key={dr.value}
              onClick={() => setDateRange(dr.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                dateRange === dr.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
              }`}
            >
              {t(dr.labelKey)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          </div>
        ) : error ? (
          <ErrorState message={t('admin.feedback.analyticsError')} onRetry={handleRefresh} retryLabel={t('admin.feedback.analyticsRetry')} />
        ) : (
          <>
            {/* Summary metrics */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              <MetricCard
                icon={<Star className="h-4 w-4 text-amber-500" />}
                label={t('admin.feedback.analyticsAvgRating')}
                value={summary?.avg_rating ? `${formatRating(summary.avg_rating, lang)} / 5` : '—'}
                color="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
              />
              <MetricCard
                icon={<BarChart3 className="h-4 w-4 text-blue-500" />}
                label={t('admin.feedback.analyticsTotalRatings')}
                value={formatNumber(summary?.total_rated ?? 0, lang)}
                color="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
              />
              <MetricCard
                icon={<Clock className="h-4 w-4 text-cyan-500" />}
                label={t('admin.feedback.analyticsNewFeedback')}
                value={formatNumber(summary?.new_count ?? 0, lang)}
                color="bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400"
              />
              <MetricCard
                icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
                label={t('admin.feedback.analyticsResolved')}
                value={formatNumber(summary?.resolved_count ?? 0, lang)}
                color="bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
              />
              <MetricCard
                icon={<Lightbulb className="h-4 w-4 text-primary-500" />}
                label={t('admin.feedback.analyticsPublicSuggestions')}
                value={formatNumber(summary?.public_suggestions_count ?? 0, lang)}
                color="bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400"
              />
              <MetricCard
                icon={<CheckCircle2 className="h-4 w-4 text-success-500" />}
                label={t('admin.feedback.analyticsImplemented')}
                value={formatNumber(summary?.implemented_suggestions_count ?? 0, lang)}
                color="bg-success-100 text-success-600 dark:bg-success-900/30 dark:text-success-400"
              />
            </div>

            {/* Resolution rate banner */}
            {summary && summary.resolution_rate !== null && (
              <div className="card flex items-center gap-3 p-4">
                <TrendingUp className="h-5 w-5 text-success-500" />
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  {t('admin.feedback.analyticsResolutionRate')}: <strong className="text-slate-900 dark:text-white">{formatPercent(summary.resolution_rate)}</strong>
                </span>
              </div>
            )}

            {/* Rating distribution + Role breakdown */}
            <div className="grid gap-6 lg:grid-cols-2">
              <SectionCard title={t('admin.feedback.analyticsRatingDist')} icon={<Star className="h-4 w-4" />}>
                {ratingDist.length === 0 || ratingDist.every((r) => r.count === 0) ? (
                  <EmptyState icon={<Star className="h-8 w-8 text-slate-400" />} title={t('admin.feedback.analyticsNoRatings')} />
                ) : (
                  <div className="space-y-3" role="list" aria-label={t('admin.feedback.analyticsRatingDist')}>
                    {ratingDist.map((r) => (
                      <RatingBar key={r.rating} rating={r.rating} count={r.count} maxCount={maxRatingCount} />
                    ))}
                  </div>
                )}
              </SectionCard>

              <SectionCard title={t('admin.feedback.analyticsRoleBreakdown')} icon={<Users className="h-4 w-4" />}>
                {roleStats.length === 0 ? (
                  <EmptyState icon={<Users className="h-8 w-8 text-slate-400" />} title={t('admin.feedback.analyticsNoData')} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700">
                          <th className="px-3 py-2 text-start text-xs font-medium text-slate-500 dark:text-slate-400">{t('admin.feedback.analyticsRoleCol')}</th>
                          <th className="px-3 py-2 text-end text-xs font-medium text-slate-500 dark:text-slate-400">{t('admin.feedback.analyticsTotalCol')}</th>
                          <th className="px-3 py-2 text-end text-xs font-medium text-slate-500 dark:text-slate-400">{t('admin.feedback.analyticsRatedCol')}</th>
                          <th className="px-3 py-2 text-end text-xs font-medium text-slate-500 dark:text-slate-400">{t('admin.feedback.analyticsAvgRating')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {roleStats.map((row) => (
                          <tr key={row.user_type}>
                            <td className="px-3 py-2 text-sm font-medium text-slate-900 dark:text-white">{t(roleLabelKey(row.user_type))}</td>
                            <td className="px-3 py-2 text-end text-sm text-slate-600 dark:text-slate-300">{formatNumber(row.total_feedback, lang)}</td>
                            <td className="px-3 py-2 text-end text-sm text-slate-600 dark:text-slate-300">{formatNumber(row.rated_count, lang)}</td>
                            <td className="px-3 py-2 text-end text-sm text-slate-600 dark:text-slate-300">{formatRating(row.avg_rating, lang)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            </div>

            {/* Category volume + Satisfaction over time */}
            <div className="grid gap-6 lg:grid-cols-2">
              <SectionCard title={t('admin.feedback.analyticsRepeatedProblems')} icon={<BarChart3 className="h-4 w-4" />}>
                {categoryStats.length === 0 ? (
                  <EmptyState icon={<BarChart3 className="h-8 w-8 text-slate-400" />} title={t('admin.feedback.analyticsNoData')} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700">
                          <th className="px-3 py-2 text-start text-xs font-medium text-slate-500 dark:text-slate-400">{t('admin.feedback.analyticsCategoryCol')}</th>
                          <th className="px-3 py-2 text-end text-xs font-medium text-slate-500 dark:text-slate-400">{t('admin.feedback.analyticsCountCol')}</th>
                          <th className="px-3 py-2 text-end text-xs font-medium text-slate-500 dark:text-slate-400">{t('admin.feedback.analyticsPercentCol')}</th>
                          <th className="px-3 py-2 text-end text-xs font-medium text-slate-500 dark:text-slate-400">{t('admin.feedback.analyticsAvgRatingCol')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {categoryStats.slice(0, 10).map((row) => (
                          <tr key={row.category}>
                            <td className="px-3 py-2 text-sm font-medium text-slate-900 dark:text-white">{t(categoryLabelKey(row.category))}</td>
                            <td className="px-3 py-2 text-end text-sm text-slate-600 dark:text-slate-300">{formatNumber(row.feedback_count, lang)}</td>
                            <td className="px-3 py-2 text-end text-sm text-slate-600 dark:text-slate-300">{formatPercent(row.percentage)}</td>
                            <td className="px-3 py-2 text-end text-sm text-slate-600 dark:text-slate-300">{formatRating(row.avg_rating, lang)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>

              <SectionCard title={t('admin.feedback.analyticsSatisfactionOverTime')} icon={<TrendingUp className="h-4 w-4" />}>
                {satisfaction.length === 0 || satisfaction.every((s) => s.rated_count === 0) ? (
                  <EmptyState icon={<TrendingUp className="h-8 w-8 text-slate-400" />} title={t('admin.feedback.analyticsNoData')} />
                ) : (
                  <div className="space-y-1.5" role="list" aria-label={t('admin.feedback.analyticsSatisfactionOverTime')}>
                    {satisfaction.map((s) => (
                      <div key={s.bucket} className="flex items-center gap-3" role="listitem">
                        <span className="w-20 shrink-0 text-xs text-slate-500 dark:text-slate-400">{s.bucket}</span>
                        <div className="relative h-6 flex-1 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-700">
                          {s.avg_rating !== null && (
                            <div
                              className="h-full rounded-lg bg-primary-500 transition-all duration-500"
                              style={{ width: `${(s.avg_rating / 5) * 100}%` }}
                            />
                          )}
                        </div>
                        <span className="w-12 shrink-0 text-end text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {s.avg_rating !== null ? formatRating(s.avg_rating, lang) : '—'}
                        </span>
                        <span className="w-8 shrink-0 text-end text-xs text-slate-400 dark:text-slate-500">
                          ({s.rated_count})
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>

            {/* Top ideas + Implemented suggestions */}
            <div className="grid gap-6 lg:grid-cols-2">
              <SectionCard title={t('admin.feedback.analyticsTopIdeas')} icon={<ThumbsUp className="h-4 w-4" />}>
                {topIdeas.length === 0 ? (
                  <EmptyState icon={<Lightbulb className="h-8 w-8 text-slate-400" />} title={t('admin.feedback.analyticsNoIdeas')} />
                ) : (
                  <div className="space-y-2">
                    {topIdeas.map((idea, idx) => (
                      <div key={idea.id} className="flex items-start gap-3 rounded-lg border border-slate-100 dark:border-slate-700 p-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{idea.title}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{t(categoryLabelKey(idea.category))}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                          <ThumbsUp className="h-3.5 w-3.5" />
                          {idea.vote_count}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              <SectionCard title={t('admin.feedback.analyticsImplementedList')} icon={<CheckCircle2 className="h-4 w-4" />}>
                {implemented.length === 0 ? (
                  <EmptyState icon={<CheckCircle2 className="h-8 w-8 text-slate-400" />} title={t('admin.feedback.analyticsNoImplemented')} />
                ) : (
                  <div className="space-y-2">
                    {implemented.map((item) => (
                      <div key={item.id} className="rounded-lg border border-slate-100 dark:border-slate-700 p-3">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{item.title}</p>
                        <div className="mt-1 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                          <span>{t(categoryLabelKey(item.category))}</span>
                          <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" /> {item.vote_count}</span>
                          <span>{new Date(item.resolved_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>

            {/* Security reports aggregate */}
            <SectionCard title={t('admin.feedback.analyticsSecurityAggregate')} icon={<ShieldAlert className="h-4 w-4" />}>
              {securityAgg && securityAgg.total > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                  <MetricCard icon={<ShieldAlert className="h-4 w-4" />} label={t('admin.feedback.analyticsSecurityTotal')} value={formatNumber(securityAgg.total, lang)} color="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" />
                  <MetricCard icon={<Clock className="h-4 w-4" />} label={t('admin.feedback.status.new')} value={formatNumber(securityAgg.new_count, lang)} color="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" />
                  <MetricCard icon={<Clock className="h-4 w-4" />} label={t('admin.feedback.status.under_review')} value={formatNumber(securityAgg.under_review_count, lang)} color="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" />
                  <MetricCard icon={<Clock className="h-4 w-4" />} label={t('admin.feedback.status.in_progress')} value={formatNumber(securityAgg.in_progress_count, lang)} color="bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400" />
                  <MetricCard icon={<CheckCircle2 className="h-4 w-4" />} label={t('admin.feedback.status.resolved')} value={formatNumber(securityAgg.resolved_count, lang)} color="bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" />
                  <MetricCard icon={<CheckCircle2 className="h-4 w-4" />} label={t('admin.feedback.status.closed')} value={formatNumber(securityAgg.closed_count, lang)} color="bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400" />
                  <MetricCard icon={<ShieldAlert className="h-4 w-4" />} label={t('admin.feedback.status.rejected')} value={formatNumber(securityAgg.rejected_count, lang)} color="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" />
                </div>
              ) : (
                <EmptyState icon={<ShieldAlert className="h-8 w-8 text-slate-400" />} title={t('admin.feedback.analyticsNoData')} />
              )}
            </SectionCard>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
