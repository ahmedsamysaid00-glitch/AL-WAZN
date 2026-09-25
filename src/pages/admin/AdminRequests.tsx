import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/i18n/useLanguage';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { Spinner, ErrorState, EmptyState } from '@/components/ui/States';
import type { UserRequestWithUser, UserRequestType, UserRequestStatus } from '@/types/database';
import {
  Clock,
  CheckCircle2,
  XCircle,
  Mail,
  Shield,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { AdminLayout } from './AdminLayout';

const PAGE_SIZE = 10;

type FilterType = 'all' | UserRequestType;
type FilterStatus = 'all' | UserRequestStatus;

export function AdminRequests() {
  const { t, dir } = useLanguage();
  const [requests, setRequests] = useState<UserRequestWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [reviewing, setReviewing] = useState<UserRequestWithUser | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionErrorDetail, setActionErrorDetail] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(false);
    let query = supabase
      .from('user_requests')
      .select('*, profiles!user_requests_user_id_fkey (email, full_name, role, verification_status)', { count: 'exact' });

    if (typeFilter !== 'all') query = query.eq('request_type', typeFilter);
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (search.trim()) query = query.or(`profiles.email.ilike.%${search.trim()}%,profiles.full_name.ilike.%${search.trim()}%`);
    query = query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    const { data, error: fetchError, count } = await query;
    if (fetchError) {
      setError(true);
    } else {
      setRequests((data ?? []) as unknown as UserRequestWithUser[]);
      setTotalCount(count ?? 0);
    }
    setLoading(false);
  }, [search, typeFilter, statusFilter, page]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  useRealtimeRefresh(
    [{ table: 'user_requests' }],
    () => fetchRequests(),
  );

  useEffect(() => {
    if (actionSuccess) {
      const timer = setTimeout(() => setActionSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [actionSuccess]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const handleApprove = async (req: UserRequestWithUser) => {
    setProcessing(true);
    setActionError(null);
    setActionErrorDetail(null);
    const rpcName =
      req.request_type === 'email_change' ? 'approve_email_change'
      : req.request_type === 'role_change' ? 'approve_role_change'
      : 'approve_account_deletion';
    const { error: rpcError } = await supabase.rpc(rpcName, { p_request_id: req.id });
    if (rpcError) {
      setActionError(t('admin.requestsApproveFailed'));
      setActionErrorDetail(null);
    } else {
      setActionSuccess(t('admin.requestsApproveSuccess'));
      setReviewing(null);
      fetchRequests();
    }
    setProcessing(false);
  };

  const handleReject = async (req: UserRequestWithUser, reason: string) => {
    setProcessing(true);
    setActionError(null);
    setActionErrorDetail(null);
    const rpcName =
      req.request_type === 'email_change' ? 'reject_email_change'
      : req.request_type === 'role_change' ? 'reject_role_change'
      : 'reject_account_deletion';
    const { error: rpcError } = await supabase.rpc(rpcName, { p_request_id: req.id, p_reason: reason });
    if (rpcError) {
      setActionError(t('admin.requestsRejectFailed'));
      setActionErrorDetail(null);
    } else {
      setActionSuccess(t('admin.requestsRejectSuccess'));
      setReviewing(null);
      setRejectMode(false);
      setRejectReason('');
      fetchRequests();
    }
    setProcessing(false);
  };


  return (
    <AdminLayout>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('admin.requestsTitle')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('admin.requestsSubtitle')}</p>
      </div>

      {actionSuccess && (
        <div className="rounded-lg bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-700 dark:text-green-300 animate-fade-in">
          {actionSuccess}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 rtl:right-3 rtl:left-auto" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={t('admin.requestsSearch')}
            className="input pl-10 rtl:pr-10 rtl:pl-4"
          />
        </div>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value as FilterType); setPage(0); }} className="input sm:w-44">
          <option value="all">{t('admin.requestsAll')}</option>
          <option value="email_change">{t('admin.requestsTypeEmailChange')}</option>
          <option value="role_change">{t('admin.requestsTypeRoleChange')}</option>
          <option value="account_deletion">{t('admin.requestsTypeAccountDeletion')}</option>
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as FilterStatus); setPage(0); }} className="input sm:w-44">
          <option value="all">{t('admin.requestsAll')}</option>
          <option value="pending">{t('admin.requestsPending')}</option>
          <option value="approved">{t('admin.requestsApproved')}</option>
          <option value="rejected">{t('admin.requestsRejected')}</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
          <span className="ml-3 text-slate-500 dark:text-slate-400">{t('admin.requestsLoading')}</span>
        </div>
      ) : error ? (
        <ErrorState message={t('admin.requestsFailed')} onRetry={fetchRequests} retryLabel={t('common.retry')} />
      ) : requests.length === 0 ? (
        <EmptyState icon={<Clock className="h-8 w-8 text-slate-400" />} title={t('admin.requestsNoResults')} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 md:block">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{t('admin.requestsUser')}</th>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{t('admin.requestsType')}</th>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{t('admin.requestsStatus')}</th>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{t('admin.requestsDate')}</th>
                  <th className="px-4 py-3 text-end text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{t('admin.requestsActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-800">
                {requests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">{req.profiles?.full_name ?? '—'}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{req.profiles?.email ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <RequestTypeBadge type={req.request_type} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={req.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                      {new Date(req.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <button onClick={() => { setReviewing(req); setRejectMode(false); setRejectReason(''); setActionError(null); setActionErrorDetail(null); }} className="btn-ghost btn-sm">
                        {t('admin.requestsReview')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {requests.map((req) => (
              <div key={req.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="break-anywhere text-sm font-medium text-slate-900 dark:text-white">{req.profiles?.full_name ?? '—'}</div>
                    <div className="break-all text-xs text-slate-500 dark:text-slate-400">{req.profiles?.email ?? '—'}</div>
                  </div>
                  <StatusBadge status={req.status} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <RequestTypeBadge type={req.request_type} />
                  <span className="text-xs text-slate-400">{new Date(req.created_at).toLocaleDateString()}</span>
                </div>
                <button onClick={() => { setReviewing(req); setRejectMode(false); setRejectReason(''); setActionError(null); setActionErrorDetail(null); }} className="btn-ghost btn-sm mt-2">
                  {t('admin.requestsReview')}
                </button>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {t('common.page')} {page + 1} {t('common.of')} {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="btn-ghost btn-sm disabled:opacity-50"
                >
                  {dir === 'rtl' ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                  {t('common.previous')}
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="btn-ghost btn-sm disabled:opacity-50"
                >
                  {t('common.next')}
                  {dir === 'rtl' ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Review modal */}
      {reviewing && (
        <ReviewModal
          request={reviewing}
          rejectMode={rejectMode}
          rejectReason={rejectReason}
          setRejectReason={setRejectReason}
          processing={processing}
          actionError={actionError}
          actionErrorDetail={actionErrorDetail}
          onClose={() => { setReviewing(null); setRejectMode(false); setRejectReason(''); setActionError(null); setActionErrorDetail(null); }}
          onApprove={() => handleApprove(reviewing)}
          onReject={() => {
            if (!rejectReason.trim()) return;
            handleReject(reviewing, rejectReason);
          }}
          onEnterRejectMode={() => setRejectMode(true)}
          onCancelReject={() => { setRejectMode(false); setRejectReason(''); }}
        />
      )}
    </div>
    </AdminLayout>
  );
}

// ============================================
// Review Modal
// ============================================

function ReviewModal({
  request,
  rejectMode,
  rejectReason,
  setRejectReason,
  processing,
  actionError,
  actionErrorDetail,
  onClose,
  onApprove,
  onReject,
  onEnterRejectMode,
  onCancelReject,
}: {
  request: UserRequestWithUser;
  rejectMode: boolean;
  rejectReason: string;
  setRejectReason: (v: string) => void;
  processing: boolean;
  actionError: string | null;
  actionErrorDetail: string | null;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onEnterRejectMode: () => void;
  onCancelReject: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl bg-white dark:bg-slate-800 shadow-xl animate-slide-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('admin.requestsReview')}</h2>
          <button onClick={onClose} className="btn-ghost btn-sm">✕</button>
        </div>

        <div className="space-y-4 px-6 py-4">
          {actionError && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {actionError}
              {actionErrorDetail && <p className="mt-1 text-xs opacity-75">{actionErrorDetail}</p>}
            </div>
          )}

          {/* User info */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DetailField label={t('admin.name')} value={request.profiles?.full_name ?? '—'} />
            <DetailField label={t('admin.requestsCurrentEmail')} value={request.profiles?.email ?? '—'} />
            <DetailField label={t('admin.requestsCurrentRole')} value={request.profiles?.role ? t(`status.${request.profiles.role}`) : '—'} />
            <DetailField label={t('admin.requestsVerificationStatus')} value={request.profiles?.verification_status ? t(`verification.status.${request.profiles.verification_status}`) : '—'} />
          </div>

          {/* Request details */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DetailField label={t('admin.requestsType')} value={
              request.request_type === 'email_change' ? t('admin.requestsTypeEmailChange')
              : request.request_type === 'role_change' ? t('admin.requestsTypeRoleChange')
              : t('admin.requestsTypeAccountDeletion')
            } />
            <DetailField label={t('admin.requestsStatus')} value={
              request.status === 'pending' ? t('admin.requestsPending')
              : request.status === 'approved' ? t('admin.requestsApproved')
              : t('admin.requestsRejected')
            } />
            {request.requested_email && <DetailField label={t('admin.requestsRequestedEmail')} value={request.requested_email} />}
            {request.requested_role && <DetailField label={t('admin.requestsRequestedRole')} value={t(`status.${request.requested_role}`)} />}
            {request.reason && <DetailField label={t('admin.requestsReason')} value={request.reason} />}
            {request.admin_reason && <DetailField label={t('settings.requestAdminReason')} value={request.admin_reason} />}
            <DetailField label={t('admin.requestsDate')} value={new Date(request.created_at).toLocaleDateString()} />
            {request.reviewed_at && <DetailField label={t('settings.requestDecisionDate')} value={new Date(request.reviewed_at).toLocaleDateString()} />}
          </div>

          {/* Actions */}
          {request.status === 'pending' && !rejectMode && (
            <div className="flex gap-2 pt-2">
              <button onClick={onApprove} disabled={processing} className="btn-primary flex-1">
                {processing ? <Spinner size="sm" /> : <><CheckCircle2 className="h-4 w-4" /> {t('admin.requestsApprove')}</>}
              </button>
              <button onClick={onEnterRejectMode} disabled={processing} className="btn-danger flex-1">
                <XCircle className="h-4 w-4" />
                {t('admin.requestsReject')}
              </button>
            </div>
          )}

          {request.status === 'pending' && rejectMode && (
            <div className="space-y-3 pt-2">
              <div>
                <label className="label">{t('admin.requestsRejectReason')}</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="input mt-1"
                  rows={3}
                  placeholder={t('admin.requestsRejectReasonPlaceholder')}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={onReject} disabled={processing || !rejectReason.trim()} className="btn-danger flex-1">
                  {processing ? <Spinner size="sm" /> : t('admin.requestsRejectConfirm')}
                </button>
                <button onClick={onCancelReject} disabled={processing} className="btn-secondary">
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Shared Components
// ============================================

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-anywhere text-sm font-medium text-slate-900 dark:text-white">{value}</dd>
    </div>
  );
}

function RequestTypeBadge({ type }: { type: UserRequestType }) {
  const { t } = useLanguage();
  const config: Record<UserRequestType, { icon: React.ReactNode; className: string; label: string }> = {
    email_change: { icon: <Mail className="h-3.5 w-3.5" />, className: 'badge-info', label: t('admin.requestsTypeEmailChange') },
    role_change: { icon: <Shield className="h-3.5 w-3.5" />, className: 'badge-warning', label: t('admin.requestsTypeRoleChange') },
    account_deletion: { icon: <Trash2 className="h-3.5 w-3.5" />, className: 'badge-error', label: t('admin.requestsTypeAccountDeletion') },
  };
  const c = config[type];
  return <span className={`badge ${c.className} gap-1`}>{c.icon}{c.label}</span>;
}

function StatusBadge({ status }: { status: UserRequestStatus }) {
  const { t } = useLanguage();
  const config: Record<UserRequestStatus, { icon: React.ReactNode; className: string; label: string }> = {
    pending: { icon: <Clock className="h-3.5 w-3.5" />, className: 'badge-warning', label: t('admin.requestsPending') },
    approved: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, className: 'badge-success', label: t('admin.requestsApproved') },
    rejected: { icon: <XCircle className="h-3.5 w-3.5" />, className: 'badge-error', label: t('admin.requestsRejected') },
  };
  const c = config[status];
  return <span className={`badge ${c.className} gap-1`}>{c.icon}{c.label}</span>;
}
