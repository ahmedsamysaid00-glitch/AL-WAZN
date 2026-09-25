import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { UserLayout } from '@/pages/user/UserLayout';
import { LoadingState, ErrorState, EmptyState, Spinner } from '@/components/ui/States';
import { Pagination } from '@/components/ui/Pagination';
import { Skeleton } from '@/components/ui/Skeleton';
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import type { TranslationKey } from '@/i18n/translations';
import type {
  Feedback,
  FeedbackType,
  FeedbackStatus,
  FeedbackCategory,
  FeedbackStatusHistory,
  FeedbackAttachment,
} from '@/types/database';
import {
  Star,
  Lightbulb,
  Bug,
  ShieldAlert,
  ClipboardList,
  Search,
  X,
  ArrowLeft,
  ArrowRight,
  MessageSquare,
  Lock,
  Paperclip,
  CheckCircle2,
  Clock,
  Eye,
  Wrench,
  Ban,
  Archive,
} from 'lucide-react';

const PAGE_SIZE = 10;

type TypeFilter = 'all' | FeedbackType;

const TYPE_FILTERS: { key: TypeFilter; labelKey: TranslationKey }[] = [
  { key: 'all', labelKey: 'feedback.my.filterAll' },
  { key: 'general_feedback', labelKey: 'feedback.my.filterGeneral' },
  { key: 'suggestion', labelKey: 'feedback.my.filterSuggestion' },
  { key: 'bug_report', labelKey: 'feedback.my.filterBug' },
  { key: 'security_report', labelKey: 'feedback.my.filterSecurity' },
];

export function FeedbackMyPage() {
  const { t, dir } = useLanguage();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast, showToast, dismissToast } = useToast();
  const [feedbackList, setFeedbackList] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fetchingRef = useRef(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const backIcon = dir === 'rtl' ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />;

  const fetchFeedback = useCallback(async (pageNum: number, filter: TypeFilter, searchQuery: string) => {
    if (!profile?.id || fetchingRef.current) return;
    fetchingRef.current = true;
    setError(false);

    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('feedback')
      .select('*', { count: 'exact' })
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (filter !== 'all') {
      query = query.eq('type', filter);
    }

    if (searchQuery.trim()) {
      query = query.or(`title.ilike.%${searchQuery.trim()}%,message.ilike.%${searchQuery.trim()}%`);
    }

    const { data, error: err, count } = await query;

    if (err) {
      setError(true);
      setFeedbackList([]);
      fetchingRef.current = false;
      return;
    }

    setFeedbackList((data as Feedback[]) ?? []);
    setTotalCount(count ?? 0);
    fetchingRef.current = false;
  }, [profile?.id]);

  useEffect(() => {
    setLoading(true);
    fetchFeedback(0, 'all', '').then(() => setLoading(false));
  }, [fetchFeedback]);

  useRealtimeRefresh(
    [{ table: 'feedback' }, { table: 'feedback_status_history' }],
    () => fetchFeedback(page, typeFilter, search),
    !!profile?.id,
  );

  const handleFilterChange = (newFilter: TypeFilter) => {
    setTypeFilter(newFilter);
    setPage(0);
    fetchFeedback(0, newFilter, search);
  };

  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearch(value);
      setPage(0);
      fetchFeedback(0, typeFilter, value);
    }, 400);
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setSearch('');
    setPage(0);
    fetchFeedback(0, typeFilter, '');
  };

  const goToPage = (newPage: number) => {
    setPage(newPage);
    fetchFeedback(newPage, typeFilter, search);
  };

  const handleRetry = () => {
    setLoading(true);
    fetchFeedback(page, typeFilter, search).then(() => setLoading(false));
  };

  if (loading) {
    return (
      <UserLayout>
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('feedback.my.title')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('feedback.my.description')}</p>
          </div>
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </UserLayout>
    );
  }

  if (error) {
    return (
      <UserLayout>
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('feedback.my.title')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('feedback.my.description')}</p>
          </div>
          <div className="card">
            <ErrorState
              message={t('feedback.my.errorLoad')}
              onRetry={handleRetry}
              retryLabel={t('common.retry')}
            />
          </div>
        </div>
      </UserLayout>
    );
  }

  return (
    <UserLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('feedback.my.title')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('feedback.my.description')}</p>
          </div>
          <button
            onClick={() => navigate('/dashboard/feedback')}
            className="btn-ghost btn-sm shrink-0"
          >
            {backIcon}
            <span className="hidden sm:inline">{t('feedback.my.backToCenter')}</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 ltr:left-3 rtl:right-3" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder={t('feedback.my.searchPlaceholder')}
            className="input ltr:pl-10 rtl:pr-10 ltr:pr-10 rtl:pl-10"
          />
          {searchInput && (
            <button
              onClick={handleClearSearch}
              className="absolute top-1/2 -translate-y-1/2 ltr:right-3 rtl:left-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              aria-label={t('feedback.my.clearSearch')}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Type Filters */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
          {TYPE_FILTERS.map((tf) => (
            <button
              key={tf.key}
              onClick={() => handleFilterChange(tf.key)}
              className={`relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors ${
                typeFilter === tf.key
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t(tf.labelKey)}
              {typeFilter === tf.key && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary-600" />}
            </button>
          ))}
        </div>

        {/* List */}
        {feedbackList.length === 0 ? (
          <div className="card">
            {search || typeFilter !== 'all' ? (
              <EmptyState
                icon={<Search className="h-8 w-8" />}
                title={t('feedback.my.filteredEmpty')}
                description={t('feedback.my.filteredEmptyDesc')}
                action={
                  <button
                    onClick={() => { handleClearSearch(); handleFilterChange('all'); }}
                    className="btn-secondary btn-sm"
                  >
                    {t('feedback.my.resetFilters')}
                  </button>
                }
              />
            ) : (
              <EmptyState
                icon={<MessageSquare className="h-8 w-8" />}
                title={t('feedback.my.emptyTitle')}
                description={t('feedback.my.emptyDesc')}
                action={
                  <button onClick={() => navigate('/dashboard/feedback')} className="btn-primary">
                    {t('feedback.my.shareFeedback')}
                  </button>
                }
              />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {feedbackList.map((item) => (
              <FeedbackListItem
                key={item.id}
                feedback={item}
                t={t}
                onClick={() => setSelectedId(item.id)}
              />
            ))}
          </div>
        )}

        <Pagination page={page} totalPages={totalPages} onPageChange={goToPage} t={t} rtl={dir === 'rtl'} />
      </div>

      {/* Detail Modal */}
      {selectedId && (
        <FeedbackDetailModal
          feedbackId={selectedId}
          onClose={() => setSelectedId(null)}
          onError={(key) => showToast('error', t(key))}
        />
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </UserLayout>
  );
}

// ============================================
// Feedback List Item
// ============================================

function FeedbackListItem({
  feedback,
  t,
  onClick,
}: {
  feedback: Feedback;
  t: (k: TranslationKey) => string;
  onClick: () => void;
}) {
  const isSecurity = feedback.type === 'security_report';
  const typeIcon = getFeedbackTypeIcon(feedback.type);
  const typeLabel = getFeedbackTypeLabel(feedback.type, t);
  const categoryLabel = getFeedbackCategoryLabel(feedback.category, t);
  const statusInfo = getStatusInfo(feedback.status, t);

  return (
    <button
      onClick={onClick}
      className="card card-hover p-5 text-start w-full animate-fade-in"
    >
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${getTypeColor(feedback.type)}`}>
          {typeIcon}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={statusInfo.badge}>{statusInfo.label}</span>
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{typeLabel}</span>
            {isSecurity && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                <Lock className="h-3 w-3" />
                {t('feedback.my.privateReport')}
              </span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
            {isSecurity ? t('feedback.my.securityTitle') : feedback.title}
          </h3>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span>{categoryLabel}</span>
            <span>{formatDate(feedback.created_at)}</span>
            {feedback.rating && (
              <span className="flex items-center gap-0.5">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {feedback.rating}/5
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ============================================
// Feedback Detail Modal
// ============================================

function FeedbackDetailModal({
  feedbackId,
  onClose,
  onError,
}: {
  feedbackId: string;
  onClose: () => void;
  onError: (key: TranslationKey) => void;
}) {
  const { t, dir } = useLanguage();
  const navigate = useNavigate();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [history, setHistory] = useState<FeedbackStatusHistory[]>([]);
  const [attachments, setAttachments] = useState<FeedbackAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const backIcon = dir === 'rtl' ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />;

  useEffect(() => {
    let cancelled = false;

    const loadDetail = async () => {
      setLoading(true);

      const [fbRes, histRes, attachRes] = await Promise.all([
        supabase.from('feedback').select('*').eq('id', feedbackId).single(),
        supabase
          .from('feedback_status_history')
          .select('*')
          .eq('feedback_id', feedbackId)
          .order('created_at', { ascending: true }),
        supabase
          .from('feedback_attachments')
          .select('*')
          .eq('feedback_id', feedbackId)
          .order('created_at', { ascending: true }),
      ]);

      if (cancelled) return;

      if (fbRes.error || !fbRes.data) {
        onError('feedback.my.errorLoad');
        setLoading(false);
        return;
      }

      setFeedback(fbRes.data as Feedback);
      setHistory((histRes.data as FeedbackStatusHistory[]) ?? []);
      const attachData = (attachRes.data as FeedbackAttachment[]) ?? [];
      setAttachments(attachData);

      // Generate signed URLs for attachments
      if (attachData.length > 0) {
        const urls: Record<string, string> = {};
        for (const att of attachData) {
          const { data: urlData } = await supabase.storage
            .from('feedback-attachments')
            .createSignedUrl(att.storage_path, 3600);
          if (urlData?.signedUrl) {
            urls[att.id] = urlData.signedUrl;
          }
        }
        if (!cancelled) setAttachmentUrls(urls);
      }

      setLoading(false);
    };

    loadDetail();

    return () => { cancelled = true; };
  }, [feedbackId, onError]);

  // Close on Escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  if (loading) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={onClose}
      >
        <div className="card max-w-lg w-full p-8" onClick={(e) => e.stopPropagation()}>
          <LoadingState />
        </div>
      </div>
    );
  }

  if (!feedback) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={onClose}
      >
        <div className="card max-w-lg w-full p-8" onClick={(e) => e.stopPropagation()}>
          <ErrorState message={t('feedback.my.errorLoad')} onRetry={onClose} />
        </div>
      </div>
    );
  }

  const isSecurity = feedback.type === 'security_report';
  const typeIcon = getFeedbackTypeIcon(feedback.type);
  const typeLabel = getFeedbackTypeLabel(feedback.type, t);
  const categoryLabel = getFeedbackCategoryLabel(feedback.category, t);
  const statusInfo = getStatusInfo(feedback.status, t);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="card max-w-lg w-full my-8 max-h-[90vh] overflow-y-auto animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-700 p-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${getTypeColor(feedback.type)}`}>
              {typeIcon}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">
                {isSecurity ? t('feedback.my.securityTitle') : feedback.title}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{typeLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm shrink-0" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 p-5">
          {/* Status & Category */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={statusInfo.badge}>{statusInfo.label}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{categoryLabel}</span>
            {isSecurity && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                <Lock className="h-3 w-3" />
                {t('feedback.my.privateReport')}
              </span>
            )}
          </div>

          {/* Rating */}
          {feedback.rating && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('feedback.my.rating')}</span>
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`h-4 w-4 ${star <= feedback.rating! ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-300 dark:fill-slate-700 dark:text-slate-600'}`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Content */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('feedback.my.content')}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">
              {feedback.message}
            </p>
          </div>

          {/* Expected behavior (bug reports) */}
          {feedback.expected_behavior && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('feedback.my.expectedBehavior')}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">
                {feedback.expected_behavior}
              </p>
            </div>
          )}

          {/* Proposed solution (suggestions) */}
          {feedback.proposed_solution && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('feedback.my.proposedSolution')}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">
                {feedback.proposed_solution}
              </p>
            </div>
          )}

          {/* Technical context (bug reports) */}
          {feedback.type === 'bug_report' && (feedback.device_type || feedback.operating_system || feedback.browser || feedback.page_url) && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('feedback.my.technicalContext')}</h3>
              <div className="flex flex-wrap gap-2">
                {feedback.device_type && <ContextChip label={t('feedback.my.device')} value={feedback.device_type} />}
                {feedback.operating_system && <ContextChip label={t('feedback.my.os')} value={feedback.operating_system} />}
                {feedback.browser && <ContextChip label={t('feedback.my.browser')} value={feedback.browser} />}
                {feedback.page_url && <ContextChip label={t('feedback.my.page')} value={feedback.page_url} />}
              </div>
            </div>
          )}

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Paperclip className="h-4 w-4" />
                {t('feedback.my.attachments')}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {attachments.map((att) => (
                  <div key={att.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                    {attachmentUrls[att.id] ? (
                      <a
                        href={attachmentUrls[att.id]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        <Paperclip className="h-4 w-4 shrink-0" />
                        <span className="truncate">{t('feedback.my.viewAttachment')}</span>
                      </a>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-slate-400">
                        <Spinner size="sm" />
                        <span>{t('feedback.my.loadingAttachment')}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dates */}
          <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-700 pt-4">
            <span>{t('feedback.my.created')}: {formatDate(feedback.created_at)}</span>
            <span>{t('feedback.my.updated')}: {formatDate(feedback.updated_at)}</span>
          </div>

          {/* Status Timeline */}
          <div className="space-y-3 border-t border-slate-100 dark:border-slate-700 pt-4">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('feedback.my.timeline')}</h3>
            <StatusTimeline
              history={history}
              currentStatus={feedback.status}
              createdAt={feedback.created_at}
              t={t}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-700 p-5">
          <button onClick={onClose} className="btn-ghost btn-sm">
            {backIcon}
            {t('feedback.my.backToList')}
          </button>
          <button
            onClick={() => navigate('/dashboard/feedback')}
            className="btn-primary btn-sm"
          >
            <MessageSquare className="h-4 w-4" />
            {t('feedback.my.shareFeedback')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Status Timeline
// ============================================

function StatusTimeline({
  history,
  currentStatus,
  createdAt,
  t,
}: {
  history: FeedbackStatusHistory[];
  currentStatus: FeedbackStatus;
  createdAt: string;
  t: (k: TranslationKey) => string;
}) {
  // Build timeline: if no history rows, show initial "new" state
  const events: { status: FeedbackStatus; date: string }[] = [];

  if (history.length === 0) {
    events.push({ status: currentStatus, date: createdAt });
  } else {
    // First event: the initial "new" status from creation
    const first = history[0];
    if (first.old_status) {
      events.push({ status: first.old_status, date: createdAt });
    }
    for (const h of history) {
      events.push({ status: h.new_status, date: h.created_at });
    }
  }

  return (
    <div className="space-y-0">
      {events.map((event, idx) => {
        const info = getStatusInfo(event.status, t);
        const isLast = idx === events.length - 1;
        const icon = getStatusIcon(event.status);

        return (
          <div key={idx} className="flex gap-3">
            {/* Line + Icon */}
            <div className="flex flex-col items-center">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isLast ? info.iconBgActive : 'bg-slate-100 dark:bg-slate-700'}`}>
                {icon}
              </div>
              {!isLast && <div className="w-px h-full min-h-[2rem] bg-slate-200 dark:bg-slate-700" />}
            </div>

            {/* Content */}
            <div className={`flex-1 ${isLast ? '' : 'pb-4'}`}>
              <p className={`text-sm font-medium ${isLast ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'}`}>
                {info.label}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {formatDate(event.date)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Context Chip
// ============================================

function ContextChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 dark:bg-slate-800 px-2 py-1 text-xs text-slate-600 dark:text-slate-400">
      <span className="font-medium text-slate-500 dark:text-slate-500">{label}:</span>
      <span className="truncate max-w-[150px]">{value}</span>
    </span>
  );
}

// ============================================
// Helpers
// ============================================

function getFeedbackTypeIcon(type: FeedbackType): React.ReactNode {
  switch (type) {
    case 'general_feedback': return <Star className="h-5 w-5 text-white" />;
    case 'suggestion': return <Lightbulb className="h-5 w-5 text-white" />;
    case 'bug_report': return <Bug className="h-5 w-5 text-white" />;
    case 'security_report': return <ShieldAlert className="h-5 w-5 text-white" />;
  }
}

function getTypeColor(type: FeedbackType): string {
  switch (type) {
    case 'general_feedback': return 'bg-gradient-to-br from-amber-400 to-orange-500';
    case 'suggestion': return 'bg-gradient-to-br from-primary-500 to-primary-600';
    case 'bug_report': return 'bg-gradient-to-br from-rose-500 to-red-500';
    case 'security_report': return 'bg-gradient-to-br from-slate-600 to-slate-800';
  }
}

function getFeedbackTypeLabel(type: FeedbackType, t: (k: TranslationKey) => string): string {
  switch (type) {
    case 'general_feedback': return t('feedback.my.typeGeneral');
    case 'suggestion': return t('feedback.my.typeSuggestion');
    case 'bug_report': return t('feedback.my.typeBug');
    case 'security_report': return t('feedback.my.typeSecurity');
  }
}

function getFeedbackCategoryLabel(category: FeedbackCategory, t: (k: TranslationKey) => string): string {
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
  return t(map[category] ?? 'feedback.category.other');
}

function getStatusInfo(status: FeedbackStatus, t: (k: TranslationKey) => string): { label: string; badge: string; iconBgActive: string } {
  const map: Record<FeedbackStatus, { labelKey: TranslationKey; badge: string; iconBgActive: string }> = {
    new: { labelKey: 'feedback.status.new', badge: 'badge-slate', iconBgActive: 'bg-slate-500' },
    under_review: { labelKey: 'feedback.status.under_review', badge: 'badge-warning', iconBgActive: 'bg-warning-500' },
    in_progress: { labelKey: 'feedback.status.in_progress', badge: 'badge-primary', iconBgActive: 'bg-primary-500' },
    resolved: { labelKey: 'feedback.status.resolved', badge: 'badge-success', iconBgActive: 'bg-success-500' },
    closed: { labelKey: 'feedback.status.closed', badge: 'badge-slate', iconBgActive: 'bg-slate-500' },
    rejected: { labelKey: 'feedback.status.rejected', badge: 'badge-error', iconBgActive: 'bg-error-500' },
    archived: { labelKey: 'feedback.status.archived', badge: 'badge-slate', iconBgActive: 'bg-slate-400' },
  };
  const info = map[status];
  return { label: t(info.labelKey), badge: info.badge, iconBgActive: info.iconBgActive };
}

function getStatusIcon(status: FeedbackStatus): React.ReactNode {
  switch (status) {
    case 'new': return <ClipboardList className="h-4 w-4 text-white" />;
    case 'under_review': return <Eye className="h-4 w-4 text-white" />;
    case 'in_progress': return <Wrench className="h-4 w-4 text-white" />;
    case 'resolved': return <CheckCircle2 className="h-4 w-4 text-white" />;
    case 'closed': return <CheckCircle2 className="h-4 w-4 text-white" />;
    case 'rejected': return <Ban className="h-4 w-4 text-white" />;
    case 'archived': return <Archive className="h-4 w-4 text-white" />;
    default: return <Clock className="h-4 w-4 text-white" />;
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
