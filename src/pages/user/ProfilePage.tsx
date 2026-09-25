import { useState, useEffect, type FormEvent } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { supabase } from '@/lib/supabase';
import { UserLayout } from './UserLayout';
import { Spinner, ErrorState } from '@/components/ui/States';
import { AlertCircle, CheckCircle2, Lock, Shield } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { UserRole, AccountStatus } from '@/types/database';
import type { ReactNode } from 'react';

type LayoutComponent = ({ children }: { children: ReactNode }) => ReactNode;

export function ProfilePage({ Layout = UserLayout }: { Layout?: LayoutComponent } = {}) {
  const { t } = useLanguage();
  const { profile, refreshProfile } = useAuth();

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? '');
      setLoadError(false);
    } else {
      setLoadError(true);
    }
    setAuthLoading(false);
  }, [profile]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    setSaving(true);
    setError(null);
    setSuccess(false);

    const { error: err } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() })
      .eq('id', profile.id);

    setSaving(false);

    if (err) {
      setError('profile.saveFailed');
      return;
    }

    try {
      await refreshProfile();
    } catch {
      setError('profile.saveFailed');
      return;
    }
    setSuccess(true);
    setEditing(false);
    setTimeout(() => setSuccess(false), 3000);
  };

  if (loadError && !profile && !authLoading) {
    return (
      <Layout>
        <ErrorState
          message={t('profile.saveFailed')}
          onRetry={() => refreshProfile()}
          retryLabel={t('common.retry')}
        />
      </Layout>
    );
  }

  if (!profile) {
    return (
      <Layout>
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('profile.title')}</h1>

        {success && (
          <div className="alert-success flex items-center gap-2 animate-slide-up">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{t('profile.saved')}</span>
          </div>
        )}

        {error && (
          <div className="alert-error flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{t(error as TranslationKey)}</span>
          </div>
        )}

        {/* Editable fields */}
        <div className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              {editing ? t('profile.editTitle') : t('profile.title')}
            </h2>
            {!editing && (
              <button onClick={() => setEditing(true)} className="btn-secondary btn-sm">
                {t('profile.edit')}
              </button>
            )}
          </div>

          {editing ? (
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="fullName" className="label">{t('profile.fullName')}</label>
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="input"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="label">{t('profile.email')}</label>
                <input
                  type="email"
                  value={profile.email}
                  disabled
                  className="input bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? <Spinner size="sm" /> : t('profile.save')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setFullName(profile.full_name ?? '');
                    setError(null);
                  }}
                  className="btn-secondary"
                  disabled={saving}
                >
                  {t('profile.cancel')}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <Field label={t('profile.fullName')} value={profile.full_name || '—'} />
              <Field label={t('profile.email')} value={profile.email} />
            </div>
          )}
        </div>

        {/* Protected fields */}
        <div className="card p-6">
          <div className="mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-slate-400 dark:text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('profile.protectedFields')}</h2>
          </div>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{t('profile.protectedFieldsDesc')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <ProtectedField label={t('profile.role')} value={roleLabel(profile.role, t)} />
            <ProtectedField label={t('profile.accountStatus')} value={statusLabel(profile.account_status, t)} />
            <ProtectedField label={t('profile.memberSince')} value={new Date(profile.created_at).toLocaleDateString()} />
          </div>
        </div>
      </div>
    </Layout>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-sm text-slate-900 dark:text-slate-100 break-all">{value}</p>
    </div>
  );
}

function ProtectedField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <div className="flex items-center gap-2">
        <Lock className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
        <span className="text-sm text-slate-700 dark:text-slate-300">{value}</span>
      </div>
    </div>
  );
}

function roleLabel(role: UserRole, t: (k: TranslationKey) => string): string {
  switch (role) {
    case 'traveler': return t('status.traveler');
    case 'sender': return t('status.sender');
    case 'admin': return t('status.admin');
    case 'marketing': return t('status.marketing');
    case 'support': return t('support.title');
  }
}

function statusLabel(s: AccountStatus, t: (k: TranslationKey) => string): string {
  switch (s) {
    case 'pending': return t('status.pending');
    case 'active': return t('status.active');
    case 'suspended': return t('status.suspended');
  }
}
