import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/i18n/useLanguage';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { Spinner, ErrorState, EmptyState } from '@/components/ui/States';
import { Skeleton, SkeletonTable } from '@/components/ui/Skeleton';
import { Pagination } from '@/components/ui/Pagination';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Toast, type ToastType } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import { AdminLayout } from './AdminLayout';
import type { TranslationKey } from '@/i18n/translations';
import type {
  FeedbackType,
  FeedbackStatus,
  FeedbackUserType,
  FeedbackCategory,
  FeedbackAttachment,
  FeedbackStatusHistory,
  FeedbackInternalNote,
} from '@/types/database';
import {
  Lightbulb,
  Search,
  Bug,
  ShieldAlert,
  MessageSquare,
  Eye,
  EyeOff,
  Archive,
  RotateCcw,
  ThumbsUp,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Lock,
  Paperclip,
  FileText,
  Plus,
  Inbox,
  X,
  BarChart3,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================

interface AdminFeedbackRow {
  id: string;
  user_id: string;
  user_type: FeedbackUserType;
  type: FeedbackType;
  category: FeedbackCategory;
  title: string;
  message: string;
  rating: number | null;
  status: FeedbackStatus;
  is_public: boolean;
  is_sensitive: boolean;
  source: string | null;
  page_url: string | null;
  device_type: string | null;
  operating_system: string | null;
  browser: string | null;
  context_type: string | null;
  context_id: string | null;
  expected_behavior: string | null;
  proposed_solution: string | null;
  archived_at: string | null;
  archived_by: string | null;
  created_at: string;
  updated_at: string;
  vote_count: number;
  submitter_name: string | null;
  submitter_email: string | null;
  submitter_role: string | null;
  total_count: number;
}

type AdminFeedbackDetail = Omit<AdminFeedbackRow, 'total_count'>;

interface AdminFeedbackSummary {
  total: number;
  new_count: number;
  under_review_count: number;
  in_progress_count: number;
  resolved_count: number;
  security_reports_count: number;
}

interface FeedbackAttachmentWithUrl extends FeedbackAttachment {
  signed_url: string | null;
}

type ConfirmState =
  | { type: 'status'; status: FeedbackStatus }
  | { type: 'publish' }
  | { type: 'unpublish' }
  | { type: 'archive' }
  | null;

// ============================================================
// Constants
// ============================================================

const PAGE_SIZE = 10;
const DESTRUCTIVE_STATUSES: FeedbackStatus[] = ['rejected', 'closed'];

const STATUS_OPTIONS: FeedbackStatus[] = [
  'new', 'under_review', 'in_progress', 'resolved', 'closed', 'rejected',
];

const STATUS_FILTER_OPTIONS: FeedbackStatus[] = [
  'new', 'under_review', 'in_progress', 'resolved', 'closed', 'rejected', 'archived',
];

const TYPE_OPTIONS: FeedbackType[] = [
  'general_feedback', 'suggestion', 'bug_report', 'security_report',
];

const ROLE_OPTIONS: FeedbackUserType[] = ['traveler', 'sender'];

const ALL_CATEGORIES: FeedbackCategory[] = [
  'new_feature', 'improve_existing_feature', 'design', 'traveler_experience',
  'sender_experience', 'communication', 'safety_trust', 'identity_verification',
  'tracking', 'payments', 'notifications', 'other',
  'registration', 'login', 'account', 'create_listing', 'search', 'orders',
  'messages', 'file_upload', 'technical_other',
  'suspicious_account', 'suspicious_listing', 'inappropriate_behavior',
  'off_platform_contact', 'privacy_issue', 'security_other',
];

const SORT_OPTIONS: { value: string; labelKey: TranslationKey }[] = [
  { value: 'newest', labelKey: 'admin.feedback.sortNewest' },
  { value: 'oldest', labelKey: 'admin.feedback.sortOldest' },
  { value: 'updated', labelKey: 'admin.feedback.sortUpdated' },
  { value: 'votes', labelKey: 'admin.feedback.sortVotes' },
];

// ============================================================
// Helper Functions
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

function statusLabelKey(status: FeedbackStatus): TranslationKey {
  const map: Record<FeedbackStatus, TranslationKey> = {
    new: 'admin.feedback.status.new',
    under_review: 'admin.feedback.status.under_review',
    in_progress: 'admin.feedback.status.in_progress',
    resolved: 'admin.feedback.status.resolved',
    closed: 'admin.feedback.status.closed',
    rejected: 'admin.feedback.status.rejected',
    archived: 'admin.feedback.status.archived',
  };
  return map[status];
}

function typeLabelKey(type: FeedbackType): TranslationKey {
  const map: Record<FeedbackType, TranslationKey> = {
    general_feedback: 'admin.feedback.type.general',
    suggestion: 'admin.feedback.type.suggestion',
    bug_report: 'admin.feedback.type.bug',
    security_report: 'admin.feedback.type.security',
  };
  return map[type];
}

function roleLabelKey(role: FeedbackUserType): TranslationKey {
  return role === 'traveler' ? 'admin.feedback.role.traveler' : 'admin.feedback.role.sender';
}

function visibilityLabelKey(isPublic: boolean): TranslationKey {
  return isPublic ? 'admin.feedback.visibility.public' : 'admin.feedback.visibility.private';
}

// ============================================================
// Badge Components
// ============================================================

function TypeBadge({ type }: { type: FeedbackType }) {
  const { t } = useLanguage();
  const config: Record<FeedbackType, { icon: ReactNode; className: string }> = {
    general_feedback: { icon: <MessageSquare className="h-3.5 w-3.5" />, className: 'badge-info' },
    suggestion: { icon: <Lightbulb className="h-3.5 w-3.5" />, className: 'badge-primary' },
    bug_report: { icon: <Bug className="h-3.5 w-3.5" />, className: 'badge-warning' },
    security_report: { icon: <ShieldAlert className="h-3.5 w-3.5" />, className: 'badge-error' },
  };
  const c = config[type];
  return <span className={`badge ${c.className} gap-1`}>{c.icon}{t(typeLabelKey(type))}</span>;
}

function StatusBadge({ status }: { status: FeedbackStatus }) {
  const { t } = useLanguage();
  const config: Record<FeedbackStatus, { icon: ReactNode; className: string }> = {
    new: { icon: <Clock className="h-3.5 w-3.5" />, className: 'badge-info' },
    under_review: { icon: <Clock className="h-3.5 w-3.5" />, className: 'badge-warning' },
    in_progress: { icon: <Clock className="h-3.5 w-3.5" />, className: 'badge-info' },
    resolved: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, className: 'badge-success' },
    closed: { icon: <XCircle className="h-3.5 w-3.5" />, className: 'badge-secondary' },
    rejected: { icon: <AlertCircle className="h-3.5 w-3.5" />, className: 'badge-error' },
    archived: { icon: <Archive className="h-3.5 w-3.5" />, className: 'badge-secondary' },
  };
  const c = config[status];
  return <span className={`badge ${c.className} gap-1`}>{c.icon}{t(statusLabelKey(status))}</span>;
}

function VisibilityBadge({ isPublic }: { isPublic: boolean }) {
  const { t } = useLanguage();
  return (
    <span className={`badge ${isPublic ? 'badge-success' : 'badge-secondary'} gap-1`}>
      {isPublic ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      {t(visibilityLabelKey(isPublic))}
    </span>
  );
}

// ============================================================
// Shared Helpers
// ============================================================

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-anywhere text-sm font-medium text-slate-900 dark:text-white">{value ?? '—'}</dd>
    </div>
  );
}

function SummaryCard({ icon, label, value, color }: { icon: ReactNode; label: string; value: number; color: string }) {
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

// ============================================================
// Main Component
// ============================================================

export function AdminFeedback() {
  const { t, dir } = useLanguage();
  const { toast, showToast, dismissToast } = useToast();

  const [feedbackRows, setFeedbackRows] = useState<AdminFeedbackRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [summary, setSummary] = useState<AdminFeedbackSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [visibilityFilter, setVisibilityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    setError(false);
    const { data, error: rpcError } = await supabase.rpc('get_admin_feedback', {
      p_page: page + 1,
      p_page_size: PAGE_SIZE,
      p_sort: sort,
      p_type: typeFilter,
      p_status: statusFilter,
      p_role: roleFilter,
      p_visibility: visibilityFilter,
      p_category: categoryFilter,
      p_search: search.trim() || null,
    });
    if (rpcError) {
      setError(true);
      setFeedbackRows([]);
      setTotalCount(0);
    } else {
      const rows = (data ?? []) as unknown as AdminFeedbackRow[];
      setFeedbackRows(rows);
      setTotalCount(rows.length > 0 ? Number(rows[0].total_count) : 0);
    }
    setLoading(false);
  }, [page, sort, typeFilter, statusFilter, roleFilter, visibilityFilter, categoryFilter, search]);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    const { data, error: rpcError } = await supabase.rpc('get_admin_feedback_summary');
    if (!rpcError && data && data.length > 0) {
      setSummary(data[0] as unknown as AdminFeedbackSummary);
    }
    setSummaryLoading(false);
  }, []);

  useEffect(() => { fetchFeedback(); }, [fetchFeedback]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  useRealtimeRefresh(
    [{ table: 'feedback' }, { table: 'feedback_votes' }],
    () => { fetchFeedback(); fetchSummary(); },
  );

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => { setPage(0); }, [search]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const hasActiveFilters = search !== '' || typeFilter !== 'all' || statusFilter !== 'all' || roleFilter !== 'all' || visibilityFilter !== 'all' || categoryFilter !== 'all';

  const handleClearFilters = () => {
    setSearchInput('');
    setSearch('');
    setTypeFilter('all');
    setStatusFilter('all');
    setRoleFilter('all');
    setVisibilityFilter('all');
    setCategoryFilter('all');
    setSort('newest');
    setPage(0);
  };

  const handleRefresh = useCallback(() => {
    fetchFeedback();
    fetchSummary();
  }, [fetchFeedback, fetchSummary]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('admin.feedback.title')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('admin.feedback.subtitle')}</p>
          </div>
          <Link to="/admin/feedback/analytics" className="btn-secondary btn-sm">
            <BarChart3 className="h-4 w-4" />
            {t('admin.feedback.analytics')}
          </Link>
        </div>

        {/* Summary Cards */}
        {summaryLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryCard icon={<Inbox className="h-4 w-4" />} label={t('admin.feedback.summaryTotal')} value={summary?.total ?? 0} color="bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400" />
            <SummaryCard icon={<Clock className="h-4 w-4" />} label={t('admin.feedback.summaryNew')} value={summary?.new_count ?? 0} color="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" />
            <SummaryCard icon={<Clock className="h-4 w-4" />} label={t('admin.feedback.summaryUnderReview')} value={summary?.under_review_count ?? 0} color="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" />
            <SummaryCard icon={<Clock className="h-4 w-4" />} label={t('admin.feedback.summaryInProgress')} value={summary?.in_progress_count ?? 0} color="bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400" />
            <SummaryCard icon={<CheckCircle2 className="h-4 w-4" />} label={t('admin.feedback.summaryResolved')} value={summary?.resolved_count ?? 0} color="bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" />
            <SummaryCard icon={<ShieldAlert className="h-4 w-4" />} label={t('admin.feedback.summarySecurity')} value={summary?.security_reports_count ?? 0} color="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 rtl:right-3 rtl:left-auto" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('admin.feedback.searchPlaceholder')}
              className="input pl-10 rtl:pr-10 rtl:pl-4"
            />
          </div>
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }} className="input sm:w-40">
            <option value="all">{t('admin.feedback.filterAllTypes')}</option>
            {TYPE_OPTIONS.map((opt) => <option key={opt} value={opt}>{t(typeLabelKey(opt))}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} className="input sm:w-40">
            <option value="all">{t('admin.feedback.filterAllStatuses')}</option>
            {STATUS_FILTER_OPTIONS.map((s) => <option key={s} value={s}>{t(statusLabelKey(s))}</option>)}
          </select>
          <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(0); }} className="input sm:w-36">
            <option value="all">{t('admin.feedback.filterAllRoles')}</option>
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{t(roleLabelKey(r))}</option>)}
          </select>
          <select value={visibilityFilter} onChange={(e) => { setVisibilityFilter(e.target.value); setPage(0); }} className="input sm:w-36">
            <option value="all">{t('admin.feedback.filterAllVisibility')}</option>
            <option value="public">{t('admin.feedback.visibility.public')}</option>
            <option value="private">{t('admin.feedback.visibility.private')}</option>
          </select>
          <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }} className="input sm:w-40">
            <option value="all">{t('admin.feedback.filterAllCategories')}</option>
            {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{t(categoryLabelKey(c))}</option>)}
          </select>
          <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }} className="input sm:w-40">
            {SORT_OPTIONS.map((s) => <option key={s.value} value={s.value}>{t(s.labelKey)}</option>)}
          </select>
        </div>

        {/* List */}
        {loading ? (
          <SkeletonTable rows={5} columns={7} />
        ) : error ? (
          <ErrorState message={t('admin.feedback.error')} onRetry={fetchFeedback} retryLabel={t('common.retry')} />
        ) : feedbackRows.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-8 w-8 text-slate-400" />}
            title={hasActiveFilters ? t('admin.feedback.emptyFiltered') : t('admin.feedback.empty')}
            description={hasActiveFilters ? t('admin.feedback.emptyFilteredDesc') : undefined}
            action={hasActiveFilters ? (
              <button onClick={handleClearFilters} className="btn-secondary btn-sm">{t('admin.feedback.clearFilters')}</button>
            ) : undefined}
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 md:block">
              <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-4 py-3 text-start text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{t('admin.feedback.colTitle')}</th>
                    <th className="px-4 py-3 text-start text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{t('admin.feedback.colType')}</th>
                    <th className="px-4 py-3 text-start text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{t('admin.feedback.colCategory')}</th>
                    <th className="px-4 py-3 text-start text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{t('admin.feedback.colRole')}</th>
                    <th className="px-4 py-3 text-start text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{t('admin.feedback.colStatus')}</th>
                    <th className="px-4 py-3 text-start text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{t('admin.feedback.colVisibility')}</th>
                    <th className="px-4 py-3 text-start text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{t('admin.feedback.colVotes')}</th>
                    <th className="px-4 py-3 text-start text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{t('admin.feedback.colCreated')}</th>
                    <th className="px-4 py-3 text-end text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{t('admin.feedback.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-800">
                  {feedbackRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {row.type === 'security_report' && <Lock className="h-3.5 w-3.5 shrink-0 text-red-500" />}
                          <span className="text-sm font-medium text-slate-900 dark:text-white truncate max-w-[200px]">{row.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3"><TypeBadge type={row.type} /></td>
                      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{t(categoryLabelKey(row.category))}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{t(roleLabelKey(row.user_type))}</td>
                      <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                      <td className="px-4 py-3"><VisibilityBadge isPublic={row.is_public} /></td>
                      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                        {row.type === 'suggestion' ? (
                          <span className="flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5" /> {row.vote_count}</span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">{new Date(row.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-end">
                        <button onClick={() => setSelectedId(row.id)} className="btn-ghost btn-sm">{t('admin.feedback.actionView')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {feedbackRows.map((row) => (
                <div key={row.id} className="card p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {row.type === 'security_report' && <Lock className="h-3.5 w-3.5 shrink-0 text-red-500" />}
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{row.title}</p>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{new Date(row.created_at).toLocaleDateString()}</p>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <TypeBadge type={row.type} />
                    <VisibilityBadge isPublic={row.is_public} />
                    {row.type === 'suggestion' && (
                      <span className="text-xs text-slate-500 flex items-center gap-1"><ThumbsUp className="h-3 w-3" /> {row.vote_count}</span>
                    )}
                  </div>
                  <button onClick={() => setSelectedId(row.id)} className="btn-ghost btn-sm">{t('admin.feedback.actionView')}</button>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} t={t} rtl={dir === 'rtl'} />
          </>
        )}

        {/* Detail Modal */}
        {selectedId && (
          <FeedbackDetailModal
            feedbackId={selectedId}
            onClose={() => setSelectedId(null)}
            onRefresh={handleRefresh}
            showToast={showToast}
          />
        )}

        <Toast toast={toast} onDismiss={dismissToast} />
      </div>
    </AdminLayout>
  );
}

// ============================================================
// Detail Modal
// ============================================================

interface FeedbackDetailModalProps {
  feedbackId: string;
  onClose: () => void;
  onRefresh: () => void;
  showToast: (type: ToastType, message: string) => void;
}

function FeedbackDetailModal({ feedbackId, onClose, onRefresh, showToast }: FeedbackDetailModalProps) {
  const { t } = useLanguage();

  const [detail, setDetail] = useState<AdminFeedbackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attachments, setAttachments] = useState<FeedbackAttachmentWithUrl[]>([]);
  const [history, setHistory] = useState<FeedbackStatusHistory[]>([]);
  const [notes, setNotes] = useState<FeedbackInternalNote[]>([]);
  const [mutating, setMutating] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [noteAdding, setNoteAdding] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  const fetchDetailData = useCallback(async () => {
    setLoading(true);
    setError(false);

    const [detailRes, attachmentsRes, historyRes, notesRes] = await Promise.all([
      supabase.rpc('get_admin_feedback_detail', { p_feedback_id: feedbackId }),
      supabase.from('feedback_attachments').select('*').eq('feedback_id', feedbackId),
      supabase.from('feedback_status_history').select('*').eq('feedback_id', feedbackId).order('created_at', { ascending: false }),
      supabase.from('feedback_internal_notes').select('*').eq('feedback_id', feedbackId).order('created_at', { ascending: false }),
    ]);

    if (detailRes.error || !detailRes.data || detailRes.data.length === 0) {
      setError(true);
      setDetail(null);
    } else {
      setDetail(detailRes.data[0] as unknown as AdminFeedbackDetail);
    }

    if (attachmentsRes.data && attachmentsRes.data.length > 0) {
      const paths = attachmentsRes.data.map((a) => a.storage_path);
      const { data: signedData } = await supabase.storage.from('feedback-attachments').createSignedUrls(paths, 3600);
      const signedUrls = (signedData ?? []) as { path: string; signedUrl?: string | null }[];
      const merged: FeedbackAttachmentWithUrl[] = attachmentsRes.data.map((a) => {
        const signed = signedUrls.find((s) => s.path === a.storage_path);
        return { ...a, signed_url: signed?.signedUrl ?? null };
      });
      setAttachments(merged);
    } else {
      setAttachments([]);
    }

    setHistory((historyRes.data ?? []) as unknown as FeedbackStatusHistory[]);
    setNotes((notesRes.data ?? []) as unknown as FeedbackInternalNote[]);
    setLoading(false);
  }, [feedbackId]);

  useEffect(() => { fetchDetailData(); }, [fetchDetailData]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !mutating) onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [mutating, onClose]);

  const handleStatusChange = async (newStatus: FeedbackStatus) => {
    setMutating(true);
    const { error: rpcError } = await supabase.rpc('set_feedback_status', {
      p_feedback_id: feedbackId,
      p_new_status: newStatus,
    });
    if (rpcError) {
      showToast('error', t('admin.feedback.toastStatusError'));
    } else {
      showToast('success', t('admin.feedback.toastStatusSuccess'));
      await fetchDetailData();
      onRefresh();
    }
    setMutating(false);
    setConfirm(null);
  };

  const onStatusSelect = (status: FeedbackStatus) => {
    if (DESTRUCTIVE_STATUSES.includes(status)) {
      setConfirm({ type: 'status', status });
    } else {
      handleStatusChange(status);
    }
  };

  const handlePublish = async (publish: boolean) => {
    setMutating(true);
    setConfirm(null);
    const { error: rpcError } = await supabase.rpc('set_feedback_public', {
      p_feedback_id: feedbackId,
      p_is_public: publish,
    });
    if (rpcError) {
      showToast('error', publish ? t('admin.feedback.toastPublishError') : t('admin.feedback.toastUnpublishError'));
    } else {
      showToast('success', publish ? t('admin.feedback.toastPublishSuccess') : t('admin.feedback.toastUnpublishSuccess'));
      await fetchDetailData();
      onRefresh();
    }
    setMutating(false);
  };

  const handleArchive = async (archive: boolean) => {
    setMutating(true);
    setConfirm(null);
    const { error: rpcError } = await supabase.rpc('archive_feedback', {
      p_feedback_id: feedbackId,
      p_archived: archive,
    });
    if (rpcError) {
      showToast('error', archive ? t('admin.feedback.toastArchiveError') : t('admin.feedback.toastUnarchiveError'));
    } else {
      showToast('success', archive ? t('admin.feedback.toastArchiveSuccess') : t('admin.feedback.toastUnarchiveSuccess'));
      await fetchDetailData();
      onRefresh();
    }
    setMutating(false);
  };

  const handleAddNote = async () => {
    if (!noteInput.trim()) return;
    setNoteAdding(true);
    const { error: rpcError } = await supabase.rpc('add_feedback_internal_note', {
      p_feedback_id: feedbackId,
      p_note: noteInput.trim(),
    });
    if (rpcError) {
      showToast('error', t('admin.feedback.toastNoteError'));
    } else {
      showToast('success', t('admin.feedback.toastNoteSuccess'));
      setNoteInput('');
      const { data: notesData } = await supabase
        .from('feedback_internal_notes')
        .select('*')
        .eq('feedback_id', feedbackId)
        .order('created_at', { ascending: false });
      setNotes((notesData ?? []) as unknown as FeedbackInternalNote[]);
    }
    setNoteAdding(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => { if (!mutating) onClose(); }} />
      <div className="relative w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto animate-slide-in" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('admin.feedback.detailTitle')}</h2>
          <button onClick={() => { if (!mutating) onClose(); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" aria-label={t('admin.feedback.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : error ? (
            <ErrorState message={t('admin.feedback.error')} onRetry={fetchDetailData} retryLabel={t('common.retry')} />
          ) : detail ? (
            <>
              {/* Security label */}
              {detail.type === 'security_report' && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                  <Lock className="h-4 w-4 shrink-0" />
                  {t('admin.feedback.detailSecurityLabel')}
                </div>
              )}

              {/* Info grid */}
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DetailField label={t('admin.feedback.detailSubmitter')} value={detail.submitter_name} />
                <DetailField label={t('admin.feedback.detailCategory')} value={t(categoryLabelKey(detail.category))} />
                <DetailField label={t('admin.feedback.colType')} value={t(typeLabelKey(detail.type))} />
                <DetailField label={t('admin.feedback.detailStatus')} value={t(statusLabelKey(detail.status))} />
                <DetailField label={t('admin.feedback.detailVisibility')} value={t(visibilityLabelKey(detail.is_public))} />
                <DetailField label={t('admin.feedback.detailVotes')} value={String(detail.vote_count)} />
                <DetailField label={t('admin.feedback.detailCreated')} value={new Date(detail.created_at).toLocaleString()} />
                <DetailField label={t('admin.feedback.detailUpdated')} value={new Date(detail.updated_at).toLocaleString()} />
                {detail.rating !== null && <DetailField label={t('admin.feedback.detailRating')} value={`${detail.rating} / 5`} />}
                {detail.submitter_email && <DetailField label={t('admin.feedback.detailSubmitterEmail')} value={detail.submitter_email} />}
              </dl>

              {/* Message */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{t('admin.feedback.detailMessage')}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{detail.message}</p>
              </div>

              {/* Technical context */}
              {(detail.source || detail.page_url || detail.device_type || detail.operating_system || detail.browser || detail.context_type || detail.expected_behavior) && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">{t('admin.feedback.detailTechnicalContext')}</h3>
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {detail.source && <DetailField label={t('admin.feedback.detailSource')} value={detail.source} />}
                    {detail.page_url && <DetailField label={t('admin.feedback.detailPageUrl')} value={detail.page_url} />}
                    {detail.device_type && <DetailField label={t('admin.feedback.detailDevice')} value={detail.device_type} />}
                    {detail.operating_system && <DetailField label={t('admin.feedback.detailOS')} value={detail.operating_system} />}
                    {detail.browser && <DetailField label={t('admin.feedback.detailBrowser')} value={detail.browser} />}
                    {detail.context_type && <DetailField label={t('admin.feedback.detailContextType')} value={detail.context_type} />}
                    {detail.expected_behavior && <DetailField label={t('admin.feedback.detailExpectedBehavior')} value={detail.expected_behavior} />}
                  </dl>
                </div>
              )}

              {/* Proposed solution */}
              {detail.proposed_solution && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{t('admin.feedback.detailProposedSolution')}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{detail.proposed_solution}</p>
                </div>
              )}

              {/* Admin actions */}
              <div className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('admin.feedback.actionStatus')}</h3>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={detail.status}
                    onChange={(e) => onStatusSelect(e.target.value as FeedbackStatus)}
                    disabled={mutating}
                    className="input flex-1 min-w-[200px]"
                  >
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{t(statusLabelKey(s))}</option>)}
                  </select>
                  {detail.type === 'suggestion' && !detail.archived_at && (
                    <button
                      onClick={() => setConfirm(detail.is_public ? { type: 'unpublish' } : { type: 'publish' })}
                      disabled={mutating}
                      className="btn-secondary btn-sm"
                    >
                      {detail.is_public ? <><EyeOff className="h-4 w-4" /> {t('admin.feedback.actionUnpublish')}</> : <><Eye className="h-4 w-4" /> {t('admin.feedback.actionPublish')}</>}
                    </button>
                  )}
                  {detail.archived_at ? (
                    <button onClick={() => handleArchive(false)} disabled={mutating} className="btn-secondary btn-sm">
                      <RotateCcw className="h-4 w-4" /> {t('admin.feedback.actionUnarchive')}
                    </button>
                  ) : (
                    <button onClick={() => setConfirm({ type: 'archive' })} disabled={mutating} className="btn-secondary btn-sm">
                      <Archive className="h-4 w-4" /> {t('admin.feedback.actionArchive')}
                    </button>
                  )}
                </div>
              </div>

              {/* Internal notes */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileText className="h-4 w-4" /> {t('admin.feedback.detailInternalNotes')}
                </h3>
                <div className="space-y-2">
                  {notes.length > 0 ? (
                    <ul className="space-y-2">
                      {notes.map((n) => (
                        <li key={n.id} className="rounded-lg bg-slate-50 dark:bg-slate-700/50 p-3">
                          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{n.note}</p>
                          <p className="text-xs text-slate-400 mt-1">{new Date(n.created_at).toLocaleString()}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">{t('admin.feedback.detailNoNotes')}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <textarea
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    className="input resize-none"
                    rows={3}
                    placeholder={t('admin.feedback.detailNotePlaceholder')}
                    disabled={noteAdding}
                  />
                  <button
                    onClick={handleAddNote}
                    disabled={noteAdding || !noteInput.trim()}
                    className="btn-primary btn-sm"
                  >
                    {noteAdding ? <Spinner size="sm" /> : <><Plus className="h-4 w-4" /> {t('admin.feedback.detailNoteAdd')}</>}
                  </button>
                </div>
              </div>

              {/* Attachments */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <Paperclip className="h-4 w-4" /> {t('admin.feedback.detailAttachments')}
                </h3>
                {attachments.length > 0 ? (
                  <ul className="space-y-2">
                    {attachments.map((a) => (
                      <li key={a.id}>
                        {a.signed_url ? (
                          <a href={a.signed_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary-600 hover:underline">
                            <Paperclip className="h-4 w-4" />
                            {a.file_type ?? 'Attachment'}
                          </a>
                        ) : (
                          <span className="flex items-center gap-2 text-sm text-slate-400">
                            <Paperclip className="h-4 w-4" />
                            {a.file_type ?? 'Attachment'}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">{t('admin.feedback.detailNoAttachments')}</p>
                )}
              </div>

              {/* Status history */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('admin.feedback.detailHistory')}</h3>
                {history.length > 0 ? (
                  <ol className="space-y-3">
                    {history.map((h) => (
                      <li key={h.id} className="flex items-start gap-3">
                        <StatusBadge status={h.new_status} />
                        <div className="min-w-0">
                          <p className="text-sm text-slate-600 dark:text-slate-300">{new Date(h.created_at).toLocaleString()}</p>
                          {h.note && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{h.note}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-slate-500">{t('admin.feedback.detailNoHistory')}</p>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Confirm dialogs */}
      {confirm?.type === 'status' && (
        <ConfirmDialog
          open
          title={t('admin.feedback.confirmStatusTitle')}
          message={`${t('admin.feedback.confirmStatusMessage')} ${t(statusLabelKey(confirm.status))}`}
          confirmLabel={t('admin.feedback.confirm')}
          cancelLabel={t('admin.feedback.cancel')}
          onConfirm={() => handleStatusChange(confirm.status)}
          onCancel={() => setConfirm(null)}
          loading={mutating}
        />
      )}
      {confirm?.type === 'publish' && (
        <ConfirmDialog
          open
          title={t('admin.feedback.confirmPublishTitle')}
          message={t('admin.feedback.confirmPublishMessage')}
          confirmLabel={t('admin.feedback.confirm')}
          cancelLabel={t('admin.feedback.cancel')}
          onConfirm={() => handlePublish(true)}
          onCancel={() => setConfirm(null)}
          loading={mutating}
        />
      )}
      {confirm?.type === 'unpublish' && (
        <ConfirmDialog
          open
          title={t('admin.feedback.confirmUnpublishTitle')}
          message={t('admin.feedback.confirmUnpublishMessage')}
          confirmLabel={t('admin.feedback.confirm')}
          cancelLabel={t('admin.feedback.cancel')}
          onConfirm={() => handlePublish(false)}
          onCancel={() => setConfirm(null)}
          loading={mutating}
        />
      )}
      {confirm?.type === 'archive' && (
        <ConfirmDialog
          open
          title={t('admin.feedback.confirmArchiveTitle')}
          message={t('admin.feedback.confirmArchiveMessage')}
          confirmLabel={t('admin.feedback.confirm')}
          cancelLabel={t('admin.feedback.cancel')}
          onConfirm={() => handleArchive(true)}
          onCancel={() => setConfirm(null)}
          loading={mutating}
          destructive
        />
      )}
    </div>
  );
}
