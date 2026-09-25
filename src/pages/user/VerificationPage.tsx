import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { UserLayout } from './UserLayout';
import { Spinner, LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import type { ReactNode } from 'react';

type LayoutComponent = ({ children }: { children: ReactNode }) => ReactNode;
import {
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  Upload,
  FileText,
  AlertCircle,
  ArrowRight,
  History,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type {
  VerificationRequest,
  VerificationStatus,
  DocumentType,
  VerificationRequestStatus,
} from '@/types/database';

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function VerificationPage({ Layout = UserLayout }: { Layout?: LayoutComponent } = {}) {
  const { t } = useLanguage();
  const { profile, refreshProfile } = useAuth();

  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Form state
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [documentType, setDocumentType] = useState<DocumentType | ''>('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [issuingCountry, setIssuingCountry] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(false);

    const { data, error: err } = await supabase
      .from('verification_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (err) {
      setError(true);
      setLoading(false);
      return;
    }

    setRequests((data as VerificationRequest[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useRealtimeRefresh(
    [
      { table: 'verification_requests', filter: `user_id=eq.${profile?.id ?? ''}` },
      { table: 'profiles', filter: `id=eq.${profile?.id ?? ''}` },
    ],
    () => {
      fetchRequests();
      refreshProfile();
    },
    !!profile?.id,
  );

  const verificationStatus: VerificationStatus = profile?.verification_status ?? 'unverified';
  const hasPendingRequest = requests.some((r) => r.status === 'pending');
  const isApproved = verificationStatus === 'approved';
  const showForm = !isApproved && !hasPendingRequest && !submitted;

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!fullName.trim()) errors.fullName = 'verification.form.required';
    if (!dateOfBirth) {
      errors.dateOfBirth = 'verification.form.required';
    } else {
      const dob = new Date(dateOfBirth);
      if (isNaN(dob.getTime()) || dob > new Date()) {
        errors.dateOfBirth = 'verification.form.invalidDate';
      }
    }
    if (!documentType) {
      errors.documentType = 'verification.form.selectDocumentType';
    }
    if (!documentNumber.trim()) errors.documentNumber = 'verification.form.required';
    if (!issuingCountry.trim()) {
      errors.issuingCountry = 'verification.form.required';
    } else if (!/^[A-Za-z]{2}$/.test(issuingCountry.trim())) {
      errors.issuingCountry = 'verification.form.invalidCountry';
    }
    if (!file) {
      errors.file = 'verification.form.required';
    } else if (!ALLOWED_MIME.includes(file.type)) {
      errors.file = 'verification.form.invalidFile';
    } else if (file.size > MAX_FILE_SIZE) {
      errors.file = 'verification.form.fileTooLarge';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!validate() || !file || !profile) return;

    setSubmitting(true);

    try {
      const filePath = `${profile.id}/${Date.now()}-${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from('identity-documents')
        .upload(filePath, file, { contentType: file.type });

      if (uploadError) {
        setSubmitError('verification.uploadFailed');
        setSubmitting(false);
        return;
      }

      const { error: insertError } = await supabase.from('verification_requests').insert({
        user_id: profile.id,
        full_name: fullName.trim(),
        date_of_birth: dateOfBirth,
        document_type: documentType,
        document_number: documentNumber.trim(),
        issuing_country: issuingCountry.trim().toUpperCase(),
        document_file_path: filePath,
        status: 'pending',
      });

      if (insertError) {
        // Clean up uploaded file if insert fails
        await supabase.storage.from('identity-documents').remove([filePath]);

        if (insertError.message.includes('duplicate') || insertError.message.includes('unique')) {
          setSubmitError('verification.alreadyPending');
        } else {
          setSubmitError('verification.submitFailed');
        }
        setSubmitting(false);
        return;
      }

      setSubmitted(true);
      setFullName('');
      setDateOfBirth('');
      setDocumentType('');
      setDocumentNumber('');
      setIssuingCountry('');
      setFile(null);
      setFormErrors({});

      await fetchRequests();
      await refreshProfile();
    } catch {
      setSubmitError('verification.submitFailed');
    }

    setSubmitting(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setFormErrors((prev) => ({ ...prev, file: '' }));
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="max-w-2xl">
          <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('verification.title')}</h1>
          <div className="card">
            <LoadingState label={t('verification.loadingStatus')} />
          </div>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="max-w-2xl">
          <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('verification.title')}</h1>
          <div className="card">
            <ErrorState
              message={t('verification.failedLoad')}
              onRetry={fetchRequests}
              retryLabel={t('common.retry')}
            />
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('verification.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('verification.subtitle')}</p>
        </div>

        {/* Status banner */}
        <StatusBanner status={verificationStatus} rejectionReason={requests.find((r) => r.status === 'rejected')?.rejection_reason ?? null} />

        {/* Submitted confirmation */}
        {submitted && (
          <div className="card p-6 animate-slide-up">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-6 w-6 shrink-0 text-success-500" />
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white">{t('verification.submittedTitle')}</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('verification.submittedDesc')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Submit error */}
        {submitError && (
          <div className="alert-error flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{t(submitError as TranslationKey)}</span>
          </div>
        )}

        {/* Verification form */}
        {showForm && (
          <div className="card p-6 animate-slide-up">
            <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{t('verification.submitTitle')}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="fullName" className="label">{t('verification.form.legalName')}</label>
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={`input ${formErrors.fullName ? 'input-error' : ''}`}
                  placeholder={t('verification.form.legalNamePlaceholder')}
                  disabled={submitting}
                />
                {formErrors.fullName && <p className="mt-1 text-xs text-error-600">{t(formErrors.fullName as TranslationKey)}</p>}
              </div>

              <div>
                <label htmlFor="dateOfBirth" className="label">{t('verification.form.dateOfBirth')}</label>
                <input
                  id="dateOfBirth"
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className={`input ${formErrors.dateOfBirth ? 'input-error' : ''}`}
                  disabled={submitting}
                />
                {formErrors.dateOfBirth && <p className="mt-1 text-xs text-error-600">{t(formErrors.dateOfBirth as TranslationKey)}</p>}
              </div>

              <div>
                <label htmlFor="documentType" className="label">{t('verification.form.documentType')}</label>
                <select
                  id="documentType"
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value as DocumentType)}
                  className={`input ${formErrors.documentType ? 'input-error' : ''}`}
                  disabled={submitting}
                >
                  <option value="">—</option>
                  <option value="passport">{t('verification.form.documentTypePassport')}</option>
                  <option value="national_id">{t('verification.form.documentTypeNationalId')}</option>
                  <option value="driver_license">{t('verification.form.documentTypeDriverLicense')}</option>
                </select>
                {formErrors.documentType && <p className="mt-1 text-xs text-error-600">{t(formErrors.documentType as TranslationKey)}</p>}
              </div>

              <div>
                <label htmlFor="documentNumber" className="label">{t('verification.form.documentNumber')}</label>
                <input
                  id="documentNumber"
                  type="text"
                  value={documentNumber}
                  onChange={(e) => setDocumentNumber(e.target.value)}
                  className={`input ${formErrors.documentNumber ? 'input-error' : ''}`}
                  placeholder={t('verification.form.documentNumberPlaceholder')}
                  disabled={submitting}
                />
                {formErrors.documentNumber && <p className="mt-1 text-xs text-error-600">{t(formErrors.documentNumber as TranslationKey)}</p>}
              </div>

              <div>
                <label htmlFor="issuingCountry" className="label">{t('verification.form.issuingCountry')}</label>
                <input
                  id="issuingCountry"
                  type="text"
                  value={issuingCountry}
                  onChange={(e) => setIssuingCountry(e.target.value)}
                  className={`input ${formErrors.issuingCountry ? 'input-error' : ''}`}
                  placeholder={t('verification.form.issuingCountryPlaceholder')}
                  maxLength={2}
                  disabled={submitting}
                />
                {formErrors.issuingCountry && <p className="mt-1 text-xs text-error-600">{t(formErrors.issuingCountry as TranslationKey)}</p>}
              </div>

              {/* File upload */}
              <div>
                <label className="label">{t('verification.form.documentUpload')}</label>
                <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{t('verification.form.documentUploadHint')}</p>
                <label
                  htmlFor="documentFile"
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors ${
                    formErrors.file ? 'border-error-300 bg-error-50 dark:bg-error-900/40' : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 hover:border-primary-400 hover:bg-primary-50 dark:bg-primary-900/30'
                  }`}
                >
                  {file ? (
                    <>
                      <FileText className="h-8 w-8 text-primary-500" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{file.name}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                      <span className="text-xs text-primary-600 dark:text-primary-400">{t('verification.form.documentChange')}</span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                      <span className="text-sm text-slate-500 dark:text-slate-400">{t('verification.form.documentUploadDrag')}</span>
                    </>
                  )}
                </label>
                <input
                  id="documentFile"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={submitting}
                />
                {formErrors.file && <p className="mt-1 text-xs text-error-600">{t(formErrors.file as TranslationKey)}</p>}
              </div>

              <button type="submit" className="btn-primary w-full" disabled={submitting}>
                {submitting ? <Spinner size="sm" /> : t('verification.form.submit')}
              </button>
            </form>
          </div>
        )}

        {/* Resubmit button after rejection */}
        {verificationStatus === 'rejected' && !hasPendingRequest && !showForm && !submitted && (
          <button
            onClick={() => { setSubmitted(false); }}
            className="btn-primary"
          >
            {t('verification.resubmit')}
          </button>
        )}

        {/* Verification history */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <History className="h-5 w-5 text-slate-400 dark:text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('verification.history')}</h2>
          </div>
          {requests.length === 0 ? (
            <div className="card">
              <EmptyState title={t('verification.historyEmpty')} />
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map((req) => (
                <HistoryItem key={req.id} request={req} t={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

function StatusBanner({
  status,
  rejectionReason,
}: {
  status: VerificationStatus;
  rejectionReason: string | null;
}) {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';

  const config = {
    unverified: {
      icon: <ShieldAlert className="h-6 w-6" />,
      bg: 'bg-warning-50 border-warning-200',
      iconBg: 'bg-warning-100 text-warning-600',
      title: t('verification.unverifiedTitle'),
      desc: t('verification.unverifiedDesc'),
    },
    pending: {
      icon: <Clock className="h-6 w-6" />,
      bg: 'bg-accent-50 dark:bg-accent-900/30 border-accent-200',
      iconBg: 'bg-accent-100 text-accent-600 dark:text-accent-400',
      title: t('verification.pendingTitle'),
      desc: t('verification.pendingDesc'),
    },
    approved: {
      icon: <CheckCircle2 className="h-6 w-6" />,
      bg: 'bg-success-50 border-success-200',
      iconBg: 'bg-success-100 text-success-600',
      title: t('verification.approvedTitle'),
      desc: t('verification.approvedDesc'),
    },
    rejected: {
      icon: <XCircle className="h-6 w-6" />,
      bg: 'bg-error-50 border-error-200',
      iconBg: 'bg-error-100 text-error-600',
      title: t('verification.rejectedTitle'),
      desc: t('verification.rejectedDesc'),
    },
  }[status];

  return (
    <div className={`card border-2 p-6 ${config.bg} animate-slide-up`}>
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${config.iconBg}`}>
          {config.icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-900 dark:text-white">{config.title}</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{config.desc}</p>
          {status === 'rejected' && rejectionReason && (
            <div className="mt-3 rounded-lg bg-white dark:bg-slate-800/60 p-3">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('verification.rejectionReason')}</p>
              <p className="mt-1 text-sm text-error-700">{rejectionReason}</p>
            </div>
          )}
          {status === 'unverified' && (
            <Link to="/dashboard/verification" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
              {t('verification.submitTitle')}
              <ArrowRight className={`h-4 w-4 ${arrow}`} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryItem({ request, t }: { request: VerificationRequest; t: (k: TranslationKey) => string }) {
  const statusConfig: Record<VerificationRequestStatus, { badge: string; icon: React.ReactNode }> = {
    pending: { badge: 'badge-warning', icon: <Clock className="h-3.5 w-3.5" /> },
    approved: { badge: 'badge-success', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    rejected: { badge: 'badge-error', icon: <XCircle className="h-3.5 w-3.5" /> },
  };
  const cfg = statusConfig[request.status];

  return (
    <div className="card p-4 animate-fade-in">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{request.full_name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('verification.submittedAt')}: {new Date(request.submitted_at).toLocaleDateString()}
          </p>
        </div>
        <span className={`badge ${cfg.badge} shrink-0`}>
          {cfg.icon}
          {request.status === 'pending' ? t('verification.status.pending') :
           request.status === 'approved' ? t('verification.status.approved') :
           t('verification.status.rejected')}
        </span>
      </div>
      {request.status === 'rejected' && request.rejection_reason && (
        <div className="mt-3 rounded-lg bg-error-50 p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('verification.rejectionReason')}</p>
          <p className="mt-1 text-sm text-error-700">{request.rejection_reason}</p>
        </div>
      )}
      {request.reviewed_at && (
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          {t('verification.reviewedAt')}: {new Date(request.reviewed_at).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
