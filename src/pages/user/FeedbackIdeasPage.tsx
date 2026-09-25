import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { UserLayout } from '@/pages/user/UserLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Pagination } from '@/components/ui/Pagination';
import { Skeleton } from '@/components/ui/Skeleton';
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import type { TranslationKey } from '@/i18n/translations';
import type { FeedbackCategory, FeedbackStatus } from '@/types/database';
import {
  Lightbulb,
  Search,
  X,
  ArrowLeft,
  ArrowRight,
  ThumbsUp,
  CheckCircle2,
  TrendingUp,
  Clock,
} from 'lucide-react';

const PAGE_SIZE = 10;

type SortKey = 'latest' | 'most_voted';
type CategoryFilter = 'all' | FeedbackCategory;

const SUGGESTION_CATEGORIES: { key: CategoryFilter; labelKey: TranslationKey }[] = [
  { key: 'all', labelKey: 'feedback.ideas.filterAll' },
  { key: 'new_feature', labelKey: 'feedback.category.new_feature' },
  { key: 'improve_existing_feature', labelKey: 'feedback.category.improve_existing_feature' },
  { key: 'design', labelKey: 'feedback.category.design' },
  { key: 'traveler_experience', labelKey: 'feedback.category.traveler_experience' },
  { key: 'sender_experience', labelKey: 'feedback.category.sender_experience' },
  { key: 'communication', labelKey: 'feedback.category.communication' },
  { key: 'safety_trust', labelKey: 'feedback.category.safety_trust' },
  { key: 'identity_verification', labelKey: 'feedback.category.identity_verification' },
  { key: 'tracking', labelKey: 'feedback.category.tracking' },
  { key: 'payments', labelKey: 'feedback.category.payments' },
  { key: 'notifications', labelKey: 'feedback.category.notifications' },
  { key: 'other', labelKey: 'feedback.category.other' },
];

const SORT_OPTIONS: { key: SortKey; labelKey: TranslationKey }[] = [
  { key: 'latest', labelKey: 'feedback.ideas.sortLatest' },
  { key: 'most_voted', labelKey: 'feedback.ideas.sortMostVoted' },
];

interface PublicIdea {
  id: string;
  title: string;
  message: string;
  category: FeedbackCategory;
  status: FeedbackStatus;
  proposed_solution: string | null;
  created_at: string;
  vote_count: number;
  has_voted: boolean;
  total_count?: number;
}

export function FeedbackIdeasPage() {
  const { t, dir } = useLanguage();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast, showToast, dismissToast } = useToast();
  const [ideas, setIdeas] = useState<PublicIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sort, setSort] = useState<SortKey>('latest');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [votingIds, setVotingIds] = useState<Set<string>>(new Set());
  const fetchingRef = useRef(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const backIcon = dir === 'rtl' ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />;

  const fetchIdeas = useCallback(async (pageNum: number, sortKey: SortKey, cat: CategoryFilter, searchQuery: string) => {
    if (!profile?.id || fetchingRef.current) return;
    fetchingRef.current = true;
    setError(false);

    const { data, error: err } = await supabase.rpc('get_public_feedback_ideas', {
      p_page: pageNum,
      p_page_size: PAGE_SIZE,
      p_sort: sortKey,
      p_category: cat === 'all' ? null : cat,
      p_search: searchQuery.trim() || null,
    });

    if (err) {
      setError(true);
      setIdeas([]);
      fetchingRef.current = false;
      return;
    }

    const rows = (data as PublicIdea[]) ?? [];
    if (rows.length > 0) {
      setTotalCount(Number(rows[0].total_count ?? 0));
    } else {
      setTotalCount(0);
    }
    setIdeas(rows);
    fetchingRef.current = false;
  }, [profile?.id]);

  useEffect(() => {
    setLoading(true);
    fetchIdeas(0, 'latest', 'all', '').then(() => setLoading(false));
  }, [fetchIdeas]);

  useRealtimeRefresh(
    [{ table: 'feedback' }, { table: 'feedback_votes' }],
    () => fetchIdeas(page, sort, categoryFilter, search),
    !!profile?.id,
  );

  const handleSortChange = (newSort: SortKey) => {
    setSort(newSort);
    setPage(0);
    fetchIdeas(0, newSort, categoryFilter, search);
  };

  const handleCategoryChange = (newCat: CategoryFilter) => {
    setCategoryFilter(newCat);
    setPage(0);
    fetchIdeas(0, sort, newCat, search);
  };

  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearch(value);
      setPage(0);
      fetchIdeas(0, sort, categoryFilter, value);
    }, 400);
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setSearch('');
    setPage(0);
    fetchIdeas(0, sort, categoryFilter, '');
  };

  const goToPage = (newPage: number) => {
    setPage(newPage);
    fetchIdeas(newPage, sort, categoryFilter, search);
  };

  const handleRetry = () => {
    setLoading(true);
    fetchIdeas(page, sort, categoryFilter, search).then(() => setLoading(false));
  };

  const handleVote = async (ideaId: string, hasVoted: boolean) => {
    if (hasVoted) return;
    setVotingIds((prev) => new Set(prev).add(ideaId));

    // Optimistic update
    setIdeas((prev) =>
      prev.map((idea) =>
        idea.id === ideaId
          ? { ...idea, has_voted: true, vote_count: idea.vote_count + 1 }
          : idea,
      ),
    );

    const { error: voteError } = await supabase.rpc('vote_feedback', { p_feedback_id: ideaId });

    if (voteError) {
      // Rollback
      setIdeas((prev) =>
        prev.map((idea) =>
          idea.id === ideaId
            ? { ...idea, has_voted: false, vote_count: idea.vote_count - 1 }
            : idea,
        ),
      );

      const errMsg = voteError.message || '';
      if (errMsg.includes('own feedback')) {
        showToast('error', t('feedback.ideas.errorSelfVote'));
      } else if (errMsg.includes('public suggestions')) {
        showToast('error', t('feedback.ideas.errorNotPublic'));
      } else if (errMsg.includes('archived') || errMsg.includes('rejected')) {
        showToast('error', t('feedback.ideas.errorArchived'));
      } else if (errMsg.includes('travelers and senders')) {
        showToast('error', t('feedback.ideas.errorUnauthorized'));
      } else {
        showToast('error', t('feedback.ideas.errorGeneric'));
      }
    } else {
      showToast('success', t('feedback.ideas.voteSuccess'));
    }

    setVotingIds((prev) => {
      const next = new Set(prev);
      next.delete(ideaId);
      return next;
    });
  };

  if (loading) {
    return (
      <UserLayout>
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('feedback.ideas.title')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('feedback.ideas.description')}</p>
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
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('feedback.ideas.title')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('feedback.ideas.description')}</p>
          </div>
          <div className="card">
            <ErrorState message={t('feedback.ideas.errorLoad')} onRetry={handleRetry} retryLabel={t('common.retry')} />
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
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('feedback.ideas.title')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('feedback.ideas.description')}</p>
          </div>
          <button onClick={() => navigate('/dashboard/feedback')} className="btn-ghost btn-sm shrink-0">
            {backIcon}
            <span className="hidden sm:inline">{t('feedback.ideas.backToCenter')}</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 ltr:left-3 rtl:right-3" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder={t('feedback.ideas.searchPlaceholder')}
            className="input ltr:pl-10 rtl:pr-10 ltr:pr-10 rtl:pl-10"
          />
          {searchInput && (
            <button
              onClick={handleClearSearch}
              className="absolute top-1/2 -translate-y-1/2 ltr:right-3 rtl:left-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              aria-label={t('feedback.ideas.clearSearch')}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Sort + Category */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Sort */}
          <div className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => handleSortChange(opt.key)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  sort === opt.key
                    ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {opt.key === 'most_voted' && <TrendingUp className="h-3.5 w-3.5" />}
                {opt.key === 'latest' && <Clock className="h-3.5 w-3.5" />}
                {t(opt.labelKey)}
              </button>
            ))}
          </div>

          {/* Category */}
          <select
            value={categoryFilter}
            onChange={(e) => handleCategoryChange(e.target.value as CategoryFilter)}
            className="input max-w-[200px]"
          >
            {SUGGESTION_CATEGORIES.map((cat) => (
              <option key={cat.key} value={cat.key}>
                {t(cat.labelKey)}
              </option>
            ))}
          </select>
        </div>

        {/* List */}
        {ideas.length === 0 ? (
          <div className="card">
            {search || categoryFilter !== 'all' ? (
              <EmptyState
                icon={<Search className="h-8 w-8" />}
                title={t('feedback.ideas.filteredEmpty')}
                description={t('feedback.ideas.filteredEmptyDesc')}
                action={
                  <button
                    onClick={() => { handleClearSearch(); handleCategoryChange('all'); }}
                    className="btn-secondary btn-sm"
                  >
                    {t('feedback.ideas.resetFilters')}
                  </button>
                }
              />
            ) : (
              <EmptyState
                icon={<Lightbulb className="h-8 w-8" />}
                title={t('feedback.ideas.emptyTitle')}
                description={t('feedback.ideas.emptyDesc')}
              />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {ideas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                t={t}
                onVote={() => handleVote(idea.id, idea.has_voted)}
                onOpen={() => setSelectedId(idea.id)}
                voting={votingIds.has(idea.id)}
              />
            ))}
          </div>
        )}

        <Pagination page={page} totalPages={totalPages} onPageChange={goToPage} t={t} rtl={dir === 'rtl'} />
      </div>

      {selectedId && (
        <IdeaDetailModal ideaId={selectedId} onClose={() => setSelectedId(null)} onVote={handleVote} voting={votingIds.has(selectedId)} />
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </UserLayout>
  );
}

// ============================================
// Idea Card
// ============================================

function IdeaCard({
  idea,
  t,
  onVote,
  onOpen,
  voting,
}: {
  idea: PublicIdea;
  t: (k: TranslationKey) => string;
  onVote: () => void;
  onOpen: () => void;
  voting: boolean;
}) {
  const statusInfo = getPublicStatusInfo(idea.status, t);
  const categoryLabel = getCategoryLabel(idea.category, t);

  return (
    <div className="card card-hover p-5 animate-fade-in">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-600">
          <Lightbulb className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={statusInfo.badge}>{statusInfo.label}</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">{categoryLabel}</span>
          </div>
          <button onClick={onOpen} className="block text-start w-full">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors line-clamp-2">
              {idea.title}
            </h3>
          </button>
          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{idea.message}</p>
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-xs text-slate-400 dark:text-slate-500">{formatDate(idea.created_at)}</span>
            <button
              onClick={onVote}
              disabled={idea.has_voted || voting}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                idea.has_voted
                  ? 'bg-success-50 dark:bg-success-900/30 text-success-600 dark:text-success-400 cursor-default'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:text-primary-600 dark:hover:text-primary-400'
              } disabled:opacity-60`}
              aria-label={idea.has_voted ? t('feedback.ideas.voted') : t('feedback.ideas.vote')}
            >
              {idea.has_voted ? <CheckCircle2 className="h-4 w-4" /> : <ThumbsUp className="h-4 w-4" />}
              <span>{idea.has_voted ? t('feedback.ideas.voted') : t('feedback.ideas.vote')}</span>
              <span className="flex items-center gap-0.5 font-semibold tabular-nums">{idea.vote_count}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Idea Detail Modal
// ============================================

function IdeaDetailModal({
  ideaId,
  onClose,
  onVote,
  voting,
}: {
  ideaId: string;
  onClose: () => void;
  onVote: (id: string, hasVoted: boolean) => void;
  voting: boolean;
}) {
  const { t, dir } = useLanguage();
  const navigate = useNavigate();
  const [idea, setIdea] = useState<PublicIdea | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const backIcon = dir === 'rtl' ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />;

  useEffect(() => {
    let cancelled = false;

    const loadDetail = async () => {
      setLoading(true);
      const { data, error: err } = await supabase.rpc('get_public_feedback_idea', {
        p_feedback_id: ideaId,
      });

      if (cancelled) return;

      if (err || !data || (Array.isArray(data) && data.length === 0)) {
        setError(true);
        setLoading(false);
        return;
      }

      const ideaData = Array.isArray(data) ? (data[0] as PublicIdea) : (data as PublicIdea);
      setIdea(ideaData);
      setLoading(false);
    };

    loadDetail();
    return () => { cancelled = true; };
  }, [ideaId]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <div className="card max-w-lg w-full p-8" onClick={(e) => e.stopPropagation()}>
          <LoadingState />
        </div>
      </div>
    );
  }

  if (error || !idea) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <div className="card max-w-lg w-full p-8" onClick={(e) => e.stopPropagation()}>
          <ErrorState message={t('feedback.ideas.errorLoad')} onRetry={onClose} />
        </div>
      </div>
    );
  }

  const statusInfo = getPublicStatusInfo(idea.status, t);
  const categoryLabel = getCategoryLabel(idea.category, t);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div className="card max-w-lg w-full my-8 max-h-[90vh] overflow-y-auto animate-fade-in" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-700 p-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-600">
              <Lightbulb className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">{idea.title}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{categoryLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm shrink-0" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={statusInfo.badge}>{statusInfo.label}</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">{formatDate(idea.created_at)}</span>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('feedback.ideas.descriptionLabel')}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">{idea.message}</p>
          </div>

          {idea.proposed_solution && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('feedback.ideas.proposedSolution')}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">{idea.proposed_solution}</p>
            </div>
          )}

          {/* Vote button */}
          <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-4">
            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <ThumbsUp className="h-4 w-4" />
              <span className="font-semibold tabular-nums">{idea.vote_count}</span>
              <span>{t('feedback.ideas.votes')}</span>
            </div>
            <button
              onClick={() => onVote(idea.id, idea.has_voted)}
              disabled={idea.has_voted || voting}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                idea.has_voted
                  ? 'bg-success-50 dark:bg-success-900/30 text-success-600 dark:text-success-400 cursor-default'
                  : 'btn-primary'
              } disabled:opacity-60`}
              aria-label={idea.has_voted ? t('feedback.ideas.voted') : t('feedback.ideas.vote')}
            >
              {idea.has_voted ? <CheckCircle2 className="h-4 w-4" /> : <ThumbsUp className="h-4 w-4" />}
              {idea.has_voted ? t('feedback.ideas.voted') : t('feedback.ideas.vote')}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-700 p-5">
          <button onClick={onClose} className="btn-ghost btn-sm">
            {backIcon}
            {t('feedback.ideas.backToList')}
          </button>
          <button onClick={() => navigate('/dashboard/feedback')} className="btn-primary btn-sm">
            <Lightbulb className="h-4 w-4" />
            {t('feedback.ideas.shareIdea')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Helpers
// ============================================

function getPublicStatusInfo(status: FeedbackStatus, t: (k: TranslationKey) => string): { label: string; badge: string } {
  const map: Record<FeedbackStatus, { labelKey: TranslationKey; badge: string }> = {
    new: { labelKey: 'feedback.ideas.statusNew', badge: 'badge-primary' },
    under_review: { labelKey: 'feedback.ideas.statusUnderReview', badge: 'badge-warning' },
    in_progress: { labelKey: 'feedback.ideas.statusInProgress', badge: 'badge-accent' },
    resolved: { labelKey: 'feedback.ideas.statusResolved', badge: 'badge-success' },
    closed: { labelKey: 'feedback.ideas.statusClosed', badge: 'badge-slate' },
    rejected: { labelKey: 'feedback.ideas.statusRejected', badge: 'badge-error' },
    archived: { labelKey: 'feedback.status.archived', badge: 'badge-slate' },
  };
  const info = map[status] ?? map.new;
  return { label: t(info.labelKey), badge: info.badge };
}

function getCategoryLabel(category: FeedbackCategory, t: (k: TranslationKey) => string): string {
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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
