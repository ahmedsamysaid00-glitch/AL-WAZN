import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { AdminLayout } from './AdminLayout';
import { LoadingState, ErrorState, EmptyState, Spinner } from '@/components/ui/States';
import {
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  Search,
  Eye,
  FileText,
  AlertCircle,
  X,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { VerificationRequestWithUser, VerificationRequestStatus } from '@/types/database';

const PAGE_SIZE = 10;

export function AdminVerification() {
  const { t } = useLanguage();
  const [requests, setRequests] = useState<VerificationRequestWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<VerificationRequestStatus | 'all'>('pending');
  const [page, setPage] = useState(0);

  // Review modal
  const [reviewing, setReviewing] = useState<VerificationRequestWithUser | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionErrorDetail, setActionErrorDetail] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(false);

    let query = supabase
      .from('verification_requests')
      .select(`
        *,
        profiles!verification_requests_user_id_fkey (
          email,
          full_name
        )
      `)
      .order('submitted_at', { ascending: false });

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    if (search.trim()) {
      query = query.or(`full_name.ilike.%${search.trim()}%,profiles.email.ilike.%${search.trim()}%`);
    }

    query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    const { data, error: err } = await query;

    if (err) {
      setError(true);
      setLoading(false);
      return;
    }

    setRequests((data as VerificationRequestWithUser[]) ?? []);
    setLoading(false);
  }, [search, statusFilter, page]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useRealtimeRefresh(
    [{ table: 'verification_requests' }],
    () => fetchRequests(),
  );

  const handleApprove = async (requestId: string) => {
    setProcessing(true);
    setActionError(null);
    setActionErrorDetail(null);

    const { error: err } = await supabase.rpc('admin_approve_verification', {
      p_request_id: requestId,
    });

    setProcessing(false);

    if (err) {
      setActionError('admin.verificationApproveFailed');
      setActionErrorDetail(null);
      return;
    }

    setActionSuccess('admin.verificationApproveSuccess');
    setReviewing(null);
    setActionErrorDetail(null);
    setTimeout(() => setActionSuccess(null), 3000);
    fetchRequests();
  };

  const handleReject = async (requestId: string) => {
    if (!rejectReason.trim()) {
      setRejectError(true);
      return;
    }

    setProcessing(true);
    setActionError(null);
    setActionErrorDetail(null);

    const { error: err } = await supabase.rpc('admin_reject_verification', {
      p_request_id: requestId,
      p_reason: rejectReason.trim(),
    });

    setProcessing(false);

    if (err) {
      setActionError('admin.verificationRejectFailed');
      setActionErrorDetail(null);
      return;
    }

    setActionSuccess('admin.verificationRejectSuccess');
    setReviewing(null);
    setRejectMode(false);
    setRejectReason('');
    setRejectError(false);
    setActionErrorDetail(null);
    setTimeout(() => setActionSuccess(null), 3000);
    fetchRequests();
  };

  const openReview = (req: VerificationRequestWithUser) => {
    setReviewing(req);
    setRejectMode(false);
    setRejectReason('');
    setRejectError(false);
    setActionError(null);
    setActionErrorDetail(null);
  };

  const closeReview = () => {
    setReviewing(null);
    setRejectMode(false);
    setRejectReason('');
    setRejectError(false);
    setActionError(null);
    setActionErrorDetail(null);
  };

  const hasFilters = search.trim() || statusFilter !== 'all';

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('admin.verificationTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('admin.verificationSubtitle')}</p>
        </div>

        {actionSuccess && (
          <div className="alert-success flex items-center gap-2 animate-slide-up">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{t(actionSuccess as TranslationKey)}</span>
          </div>
        )}

        {actionError && !reviewing && (
          <div className="alert-error flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p>{t(actionError as TranslationKey)}</p>
              {actionErrorDetail && <p className="mt-0.5 text-xs opacity-80">{actionErrorDetail}</p>}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="card p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500 ltr:left-3.5 rtl:right-3.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                placeholder={t('admin.verificationSearch')}
                className="input ltr:pl-10 rtl:pr-10"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as VerificationRequestStatus | 'all'); setPage(0); }}
              className="input min-w-[160px]"
            >
              <option value="all">{t('admin.verificationAll')}</option>
              <option value="pending">{t('admin.verificationPending')}</option>
              <option value="approved">{t('admin.verificationApproved')}</option>
              <option value="rejected">{t('admin.verificationRejected')}</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          {loading ? (
            <LoadingState label={t('admin.verificationLoading')} />
          ) : error ? (
            <ErrorState
              message={t('admin.verificationFailed')}
              onRetry={fetchRequests}
              retryLabel={t('common.retry')}
            />
          ) : requests.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="h-8 w-8" />}
              title={hasFilters ? t('admin.verificationNoResults') : t('empty.noVerification')}
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-left">
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.verificationUser')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.verificationLegalName')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.verificationDocType')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.verificationCountry')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.verificationSubmitted')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.verificationStatus')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200 text-right">{t('admin.verificationActions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {requests.map((req) => (
                      <tr key={req.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900 dark:text-white">{req.profiles?.full_name || '—'}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 break-all">{req.profiles?.email}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{req.full_name}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{docTypeLabel(req.document_type, t)}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{req.issuing_country}</td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{new Date(req.submitted_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={req.status} t={t} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openReview(req)}
                            className="btn-secondary btn-sm"
                            disabled={req.status !== 'pending'}
                          >
                            <Eye className="h-4 w-4" />
                            {t('admin.verificationReview')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="divide-y divide-slate-100 md:hidden">
                {requests.map((req) => (
                  <div key={req.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900 dark:text-white">{req.profiles?.full_name || '—'}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 break-all">{req.profiles?.email}</p>
                      </div>
                      <StatusBadge status={req.status} t={t} />
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <p>{t('admin.verificationLegalName')}: {req.full_name}</p>
                      <p>{t('admin.verificationDocType')}: {docTypeLabel(req.document_type, t)}</p>
                      <p>{t('admin.verificationCountry')}: {req.issuing_country}</p>
                      <p>{t('admin.verificationSubmitted')}: {new Date(req.submitted_at).toLocaleDateString()}</p>
                    </div>
                    {req.status === 'pending' && (
                      <button
                        onClick={() => openReview(req)}
                        className="btn-secondary btn-sm mt-3 w-full"
                      >
                        <Eye className="h-4 w-4" />
                        {t('admin.verificationReview')}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 px-4 py-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.page')} {page + 1}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="btn-secondary btn-sm"
                  >
                    {t('common.previous')}
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={requests.length < PAGE_SIZE}
                    className="btn-secondary btn-sm"
                  >
                    {t('common.next')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Review modal */}
      {reviewing && (
        <ReviewModal
          request={reviewing}
          rejectMode={rejectMode}
          rejectReason={rejectReason}
          rejectError={rejectError}
          processing={processing}
          actionError={actionError}
          actionErrorDetail={actionErrorDetail}
          t={t}
          onClose={closeReview}
          onApprove={() => handleApprove(reviewing.id)}
          onReject={() => handleReject(reviewing.id)}
          onEnterRejectMode={() => setRejectMode(true)}
          onRejectReasonChange={setRejectReason}
          onRejectErrorChange={setRejectError}
        />
      )}
    </AdminLayout>
  );
}

function ReviewModal({
  request,
  rejectMode,
  rejectReason,
  rejectError,
  processing,
  actionError,
  actionErrorDetail,
  t,
  onClose,
  onApprove,
  onReject,
  onEnterRejectMode,
  onRejectReasonChange,
  onRejectErrorChange,
}: {
  request: VerificationRequestWithUser;
  rejectMode: boolean;
  rejectReason: string;
  rejectError: boolean;
  processing: boolean;
  actionError: string | null;
  actionErrorDetail: string | null;
  t: (k: TranslationKey) => string;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onEnterRejectMode: () => void;
  onRejectReasonChange: (v: string) => void;
  onRejectErrorChange: (v: boolean) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900 dark:bg-slate-950/50 animate-fade-in" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-800 shadow-elevated animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('admin.verificationReview')}</h2>
          <button onClick={onClose} className="btn-ghost btn-sm">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-6">
          {/* User info */}
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-4">
            <p className="font-medium text-slate-900 dark:text-white">{request.profiles?.full_name || '—'}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 break-all">{request.profiles?.email}</p>
          </div>

          {/* Details */}
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailField label={t('admin.verificationLegalName')} value={request.full_name} />
            <DetailField label={t('admin.verificationDob')} value={new Date(request.date_of_birth).toLocaleDateString()} />
            <DetailField label={t('admin.verificationDocType')} value={docTypeLabel(request.document_type, t)} />
            <DetailField label={t('admin.verificationDocNumber')} value={request.document_number} />
            <DetailField label={t('admin.verificationCountry')} value={request.issuing_country} />
            <DetailField label={t('admin.verificationSubmitted')} value={new Date(request.submitted_at).toLocaleDateString()} />
          </div>

          {/* Document link */}
          <DocumentLink path={request.document_file_path} t={t} />

          {/* Rejection reason input */}
          {rejectMode && (
            <div className="animate-slide-up">
              <label htmlFor="rejectReason" className="label">{t('admin.verificationRejectReasonRequired')}</label>
              <textarea
                id="rejectReason"
                value={rejectReason}
                onChange={(e) => { onRejectReasonChange(e.target.value); onRejectErrorChange(false); }}
                className={`input min-h-[100px] resize-y ${rejectError ? 'input-error' : ''}`}
                placeholder={t('admin.verificationRejectReasonPlaceholder')}
                disabled={processing}
              />
              {rejectError && <p className="mt-1 text-xs text-error-600">{t('admin.verificationRejectReasonRequired')}</p>}
            </div>
          )}

          {/* Error message inside modal */}
          {actionError && (
            <div className="alert-error flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p>{t(actionError as TranslationKey)}</p>
                {actionErrorDetail && <p className="mt-0.5 text-xs opacity-80">{actionErrorDetail}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-700 px-6 py-4">
          {!rejectMode ? (
            <>
              <button onClick={onClose} className="btn-secondary" disabled={processing}>
                {t('common.cancel')}
              </button>
              <button
                onClick={onEnterRejectMode}
                className="btn-danger"
                disabled={processing}
              >
                <XCircle className="h-4 w-4" />
                {t('admin.verificationReject')}
              </button>
              <button onClick={onApprove} className="btn-primary" disabled={processing}>
                {processing ? <Spinner size="sm" /> : <CheckCircle2 className="h-4 w-4" />}
                {t('admin.verificationApprove')}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => { onRejectReasonChange(''); onRejectErrorChange(false); }}
                className="btn-secondary"
                disabled={processing}
              >
                {t('common.cancel')}
              </button>
              <button onClick={onReject} className="btn-danger" disabled={processing}>
                {processing ? <Spinner size="sm" /> : <XCircle className="h-4 w-4" />}
                {t('admin.verificationRejectConfirm')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-sm text-slate-900 dark:text-slate-100 break-all">{value}</p>
    </div>
  );
}

function DocumentLink({ path, t }: { path: string; t: (k: TranslationKey) => string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const handleView = async () => {
    setLoading(true);
    setError(false);

    const { data, error: err } = await supabase.storage
      .from('identity-documents')
      .createSignedUrl(path, 60); // 60 second signed URL

    setLoading(false);

    if (err || !data?.signedUrl) {
      setError(true);
      return;
    }

    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {t('verification.viewDocument')}
      </p>
      <button onClick={handleView} disabled={loading} className="btn-secondary btn-sm">
        {loading ? <Spinner size="sm" /> : <FileText className="h-4 w-4" />}
        {loading ? t('common.loading') : t('verification.viewDocument')}
      </button>
      {error && <p className="mt-1 text-xs text-error-600">{t('verification.documentNotAvailable')}</p>}
    </div>
  );
}

function StatusBadge({ status, t }: { status: VerificationRequestStatus; t: (k: TranslationKey) => string }) {
  const config: Record<VerificationRequestStatus, { badge: string; icon: React.ReactNode; label: string }> = {
    pending: { badge: 'badge-warning', icon: <Clock className="h-3.5 w-3.5" />, label: t('admin.verificationPending') },
    approved: { badge: 'badge-success', icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: t('admin.verificationApproved') },
    rejected: { badge: 'badge-error', icon: <XCircle className="h-3.5 w-3.5" />, label: t('admin.verificationRejected') },
  };
  const cfg = config[status];
  return (
    <span className={`badge ${cfg.badge}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function docTypeLabel(type: string, t: (k: TranslationKey) => string): string {
  switch (type) {
    case 'passport': return t('verification.form.documentTypePassport');
    case 'national_id': return t('verification.form.documentTypeNationalId');
    case 'driver_license': return t('verification.form.documentTypeDriverLicense');
    default: return type;
  }
}
