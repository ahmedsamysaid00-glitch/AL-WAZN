import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import type { TranslationKey } from '@/i18n/translations';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { Spinner, ErrorState, EmptyState } from '@/components/ui/States';
import type { UserRequest } from '@/types/database';
import {
  User as UserIcon,
  Shield,
  Lock,
  Bell,
  Clock,
  Trash2,
  Mail,
  KeyRound,
  LogOut,
  CheckCircle2,
  XCircle,
  Clock as ClockIcon,
  AlertTriangle,
  Globe,
  Headphones,
 MessageSquare,
  Lightbulb,
} from 'lucide-react';

type Section = 'account' | 'role' | 'security' | 'notifications' | 'preferences' | 'activity' | 'deletion' | 'support' | 'feedback';

interface NotifPref {
  new_messages: boolean;
  collaboration_requests: boolean;
  collaboration_updates: boolean;
  orders: boolean;
  order_status_changes: boolean;
  shipment_updates: boolean;
  payments: boolean;
  system_notifications: boolean;
}

const DEFAULT_PREFS: NotifPref = {
  new_messages: true,
  collaboration_requests: true,
  collaboration_updates: true,
  orders: true,
  order_status_changes: true,
  shipment_updates: true,
  payments: true,
  system_notifications: true,
};

export function SettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const { t } = useLanguage();
  const [activeSection, setActiveSection] = useState<Section>('account');
  const [requests, setRequests] = useState<UserRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [requestsError, setRequestsError] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotifPref>(DEFAULT_PREFS);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [currency, setCurrency] = useState(profile?.preferred_currency ?? 'USD');
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [currencyError, setCurrencyError] = useState<string | null>(null);
  const [currencySuccess, setCurrencySuccess] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [prefsSuccess, setPrefsSuccess] = useState(false);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportError, setSupportError] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchRequests = useCallback(async () => {
    if (!profile?.id) return;
    setLoadingRequests(true);
    setRequestsError(false);
    const { data, error } = await supabase
      .from('user_requests')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });
    if (error) {
      setRequestsError(true);
    } else {
      setRequests(data ?? []);
    }
    setLoadingRequests(false);
  }, [profile?.id]);

  const fetchPrefs = useCallback(async () => {
    if (!profile?.id) return;
    setLoadingPrefs(true);
    const { data, error } = await supabase.rpc('get_notification_preferences');
    if (error || !data) {
      setNotifPrefs(DEFAULT_PREFS);
    } else {
      setNotifPrefs(data.preferences ?? DEFAULT_PREFS);
    }
    setLoadingPrefs(false);
  }, [profile?.id]);

  useEffect(() => {
    fetchRequests();
    fetchPrefs();
  }, [fetchRequests, fetchPrefs]);

  useRealtimeRefresh(
    [{ table: 'user_requests', filter: `user_id=eq.${profile?.id ?? ''}` }],
    () => fetchRequests(),
    !!profile?.id,
  );

  if (!profile) {
    return <LoadingState />;
  }

  const isMarketer = profile.role === 'marketing';

  const sections: { key: Section; label: string; icon: React.ReactNode }[] = [
    { key: 'account', label: t('settings.account'), icon: <UserIcon className="h-5 w-5" /> },
    ...(!isMarketer ? [{ key: 'role' as Section, label: t('settings.role'), icon: <Shield className="h-5 w-5" /> }] : []),
    { key: 'security', label: t('settings.security'), icon: <Lock className="h-5 w-5" /> },
    { key: 'notifications', label: t('settings.notifications'), icon: <Bell className="h-5 w-5" /> },
    { key: 'preferences', label: t('settings.preferences'), icon: <Globe className="h-5 w-5" /> },
    { key: 'activity', label: t('settings.activityRequests'), icon: <Clock className="h-5 w-5" /> },
    ...(!isMarketer ? [{ key: 'support' as Section, label: t('support.contactSupport'), icon: <Headphones className="h-5 w-5" /> }] : []),
    ...(!isMarketer && (profile.role === 'traveler' || profile.role === 'sender') ? [{ key: 'feedback' as Section, label: t('feedback.settingsEntry'), icon: <Lightbulb className="h-5 w-5" /> }] : []),
    { key: 'deletion', label: t('settings.accountDeletion'), icon: <Trash2 className="h-5 w-5" /> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('settings.title')}</h1>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Section tabs */}
        <div className="lg:w-64 shrink-0">
          <div className="flex gap-2 overflow-x-auto lg:flex-col">
            {sections.map((s) => (
              <button
                key={s.key}
                onClick={() => setActiveSection(s.key)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeSection === s.key
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {activeSection === 'account' && <AccountSection profile={profile} />}
          {activeSection === 'role' && <RoleSection profile={profile} requests={requests} onRequestSubmitted={fetchRequests} />}
          {activeSection === 'security' && <SecuritySection profile={profile} />}
          {activeSection === 'notifications' && (
            <NotificationsSection
              prefs={notifPrefs}
              setPrefs={setNotifPrefs}
              loading={loadingPrefs}
              saving={savingPrefs}
              onSave={async () => {
                setSavingPrefs(true);
                setPrefsError(null);
                setPrefsSuccess(false);
                const { error } = await supabase.rpc('update_notification_preferences', { p_prefs: notifPrefs });
                if (error) {
                  setPrefsError(t('settings.notifSaveFailed'));
                } else {
                  setPrefsSuccess(true);
                  setTimeout(() => setPrefsSuccess(false), 3000);
                }
                setSavingPrefs(false);
              }}
              error={prefsError}
              success={prefsSuccess}
            />
          )}
          {activeSection === 'preferences' && (
            <PreferencesSection
              currency={currency}
              setCurrency={setCurrency}
              saving={savingCurrency}
              onSave={async () => {
                setSavingCurrency(true);
                setCurrencyError(null);
                setCurrencySuccess(false);
                const { error } = await supabase.rpc('update_preferred_currency', { p_currency: currency });
                if (error) {
                  setCurrencyError(t('settings.currencySaveFailed'));
                } else {
                  setCurrencySuccess(true);
                  setTimeout(() => setCurrencySuccess(false), 3000);
                  refreshProfile();
                }
                setSavingCurrency(false);
              }}
              error={currencyError}
              success={currencySuccess}
            />
          )}
          {activeSection === 'activity' && (
            <ActivitySection
              requests={requests}
              loading={loadingRequests}
              error={requestsError}
              onRetry={fetchRequests}
            />
          )}
          {activeSection === 'deletion' && <DeletionSection profile={profile} onRequestSubmitted={fetchRequests} />}
          {activeSection === 'support' && (
            <SupportSection
              loading={supportLoading}
              error={supportError}
              onOpen={async () => {
                setSupportLoading(true);
                setSupportError(null);
                const { data, error } = await supabase.rpc('get_or_create_support_conversation');
                setSupportLoading(false);
                if (error || !data) {
                  setSupportError(t('support.openFailed'));
                  return;
                }
                navigate(`/dashboard/messages/${data}`);
              }}
            />
          )}
          {activeSection === 'feedback' && (
            <FeedbackSection onOpen={() => navigate('/dashboard/feedback')} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Account Section
// ============================================

function AccountSection({ profile }: { profile: NonNullable<ReturnType<typeof useAuth>['profile']> }) {
  const { t } = useLanguage();
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    const { error: rpcError } = await supabase.rpc('request_email_change', { p_new_email: newEmail });
    if (rpcError) {
      setError(rpcError.message);
    } else {
      setSuccess(true);
      setShowEmailForm(false);
      setNewEmail('');
      setTimeout(() => setSuccess(false), 3000);
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-6">
      <SettingsCard title={t('settings.account')} icon={<UserIcon className="h-5 w-5" />}>
        <Field label={t('settings.fullName')} value={profile.full_name ?? '—'} />
        <Field label={t('settings.currentEmail')} value={profile.email} />
        <Field label={t('settings.verificationStatus')} value={t(`verification.status.${profile.verification_status}`)} />
        <Field label={t('settings.accountStatus')} value={t(`status.${profile.account_status}`)} />
      </SettingsCard>

      <SettingsCard title={t('settings.changeEmail')} icon={<Mail className="h-5 w-5" />}>
        {success && <SuccessAlert message={t('settings.emailChangeSuccess')} />}
        {error && <ErrorAlert message={error} />}
        {showEmailForm ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.emailChangeDesc')}</p>
            <div>
              <label className="label">{t('settings.emailChangeNewEmail')}</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="input mt-1"
                placeholder="new@email.com"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSubmit}
                disabled={submitting || !newEmail}
                className="btn-primary"
              >
                {submitting ? <Spinner size="sm" /> : t('settings.emailChangeSubmit')}
              </button>
              <button onClick={() => { setShowEmailForm(false); setNewEmail(''); setError(null); }} className="btn-secondary">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowEmailForm(true)} className="btn-secondary">
            <Mail className="h-4 w-4" />
            {t('settings.changeEmail')}
          </button>
        )}
      </SettingsCard>
    </div>
  );
}

// ============================================
// Role Section
// ============================================

function RoleSection({
  profile,
  requests,
  onRequestSubmitted,
}: {
  profile: NonNullable<ReturnType<typeof useAuth>['profile']>;
  requests: UserRequest[];
  onRequestSubmitted: () => void;
}) {
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [requestedRole, setRequestedRole] = useState<'sender' | 'traveler'>(profile.role === 'sender' ? 'traveler' : 'sender');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const pendingRoleRequest = requests.find(r => r.request_type === 'role_change' && r.status === 'pending');

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    const { error: rpcError } = await supabase.rpc('request_role_change', { p_requested_role: requestedRole });
    if (rpcError) {
      setError(rpcError.message);
    } else {
      setSuccess(true);
      setShowForm(false);
      setTimeout(() => setSuccess(false), 3000);
      onRequestSubmitted();
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-6">
      <SettingsCard title={t('settings.role')} icon={<Shield className="h-5 w-5" />}>
        <Field label={t('settings.currentRole')} value={t(`status.${profile.role}`)} />
      </SettingsCard>

      <SettingsCard title={t('settings.requestRoleChange')} icon={<Shield className="h-5 w-5" />}>
        {success && <SuccessAlert message={t('settings.roleChangeSuccess')} />}
        {error && <ErrorAlert message={error} />}
        {pendingRoleRequest ? (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <ClockIcon className="h-4 w-4 shrink-0" />
            {t('settings.roleChangePending')}
          </div>
        ) : showForm ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.roleChangeDesc')}</p>
            <div>
              <label className="label">{t('settings.selectNewRole')}</label>
              <div className="mt-2 flex gap-3">
                <RoleOption
                  label={t('status.sender')}
                  selected={requestedRole === 'sender'}
                  onClick={() => setRequestedRole('sender')}
                  disabled={profile.role === 'sender'}
                />
                <RoleOption
                  label={t('status.traveler')}
                  selected={requestedRole === 'traveler'}
                  onClick={() => setRequestedRole('traveler')}
                  disabled={profile.role === 'traveler'}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSubmit} disabled={submitting} className="btn-primary">
                {submitting ? <Spinner size="sm" /> : t('settings.roleChangeSubmit')}
              </button>
              <button onClick={() => { setShowForm(false); setError(null); }} className="btn-secondary">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowForm(true)} className="btn-secondary">
            <Shield className="h-4 w-4" />
            {t('settings.requestRoleChange')}
          </button>
        )}
      </SettingsCard>
    </div>
  );
}

// ============================================
// Security Section
// ============================================

function SecuritySection({ profile }: { profile: NonNullable<ReturnType<typeof useAuth>['profile']> }) {
  const { t } = useLanguage();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutSuccess, setSignOutSuccess] = useState(false);

  const handleChangePassword = async () => {
    setError(null);
    setSuccess(false);
    if (newPassword.length < 8) {
      setError(t('settings.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('settings.passwordMismatch'));
      return;
    }
    setSubmitting(true);

    // Verify current password by re-authenticating
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: currentPassword,
    });
    if (signInError) {
      setError(t('settings.passwordCurrentWrong'));
      setSubmitting(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    await supabase.rpc('change_password', { p_current_password: currentPassword, p_new_password: newPassword });
    setSuccess(true);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setTimeout(() => setSuccess(false), 3000);
    setSubmitting(false);
  };

  const handleSignOutAll = async () => {
    setSigningOut(true);
    await supabase.auth.signOut({ scope: 'others' });
    setSignOutSuccess(true);
    setTimeout(() => setSignOutSuccess(false), 3000);
    setSigningOut(false);
  };

  return (
    <div className="space-y-6">
      <SettingsCard title={t('settings.changePassword')} icon={<KeyRound className="h-5 w-5" />}>
        {success && <SuccessAlert message={t('settings.passwordSuccess')} />}
        {error && <ErrorAlert message={error} />}
        <div className="space-y-4">
          <div>
            <label className="label">{t('settings.passwordCurrent')}</label>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="input mt-1" autoComplete="current-password" />
          </div>
          <div>
            <label className="label">{t('settings.passwordNew')}</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input mt-1" autoComplete="new-password" />
          </div>
          <div>
            <label className="label">{t('settings.passwordConfirm')}</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="input mt-1" autoComplete="new-password" />
          </div>
          <button onClick={handleChangePassword} disabled={submitting || !currentPassword || !newPassword || !confirmPassword} className="btn-primary">
            {submitting ? <Spinner size="sm" /> : t('settings.passwordSubmit')}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard title={t('settings.signOutAll')} icon={<LogOut className="h-5 w-5" />}>
        {signOutSuccess && <SuccessAlert message={t('settings.signOutAllSuccess')} />}
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.signOutAllDesc')}</p>
        <button onClick={handleSignOutAll} disabled={signingOut} className="btn-secondary mt-3">
          {signingOut ? <Spinner size="sm" /> : <><LogOut className="h-4 w-4" /> {t('settings.signOutAll')}</>}
        </button>
      </SettingsCard>
    </div>
  );
}

// ============================================
// Notifications Section
// ============================================

function NotificationsSection({
  prefs,
  setPrefs,
  loading,
  saving,
  onSave,
  error,
  success,
}: {
  prefs: NotifPref;
  setPrefs: (p: NotifPref) => void;
  loading: boolean;
  saving: boolean;
  onSave: () => void;
  error: string | null;
  success: boolean;
}) {
  const { t } = useLanguage();

  const { profile } = useAuth();
  const isMarketer = profile?.role === 'marketing';

  const categories: { key: keyof NotifPref; label: string }[] = [
    { key: 'new_messages', label: t('settings.notifNewMessages') },
    ...(!isMarketer ? [
      { key: 'collaboration_requests' as keyof NotifPref, label: t('settings.notifCollabRequests') },
      { key: 'collaboration_updates' as keyof NotifPref, label: t('settings.notifCollabUpdates') },
      { key: 'orders' as keyof NotifPref, label: t('settings.notifOrders') },
      { key: 'order_status_changes' as keyof NotifPref, label: t('settings.notifOrderStatus') },
      { key: 'shipment_updates' as keyof NotifPref, label: t('settings.notifShipmentUpdates') },
      { key: 'payments' as keyof NotifPref, label: t('settings.notifPayments') },
    ] : []),
    { key: 'system_notifications', label: t('settings.notifSystem') },
  ];

  const toggleAll = (value: boolean) => {
    if (isMarketer) {
      setPrefs({ ...prefs, new_messages: value, system_notifications: value });
    } else {
      const allTrue: NotifPref = {
        new_messages: value, collaboration_requests: value, collaboration_updates: value,
        orders: value, order_status_changes: value, shipment_updates: value,
        payments: value, system_notifications: value,
      };
      setPrefs(allTrue);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <SettingsCard title={t('settings.notifPrefs')} icon={<Bell className="h-5 w-5" />}>
      {success && <SuccessAlert message={t('settings.notifSaved')} />}
      {error && <ErrorAlert message={error} />}
      <div className="flex gap-2 mb-4">
        <button onClick={() => toggleAll(true)} className="btn-secondary btn-sm">{t('settings.notifEnableAll')}</button>
        <button onClick={() => toggleAll(false)} className="btn-secondary btn-sm">{t('settings.notifDisableAll')}</button>
      </div>
      <div className="space-y-3">
        {categories.map((cat) => (
          <label key={cat.key} className="flex items-center justify-between cursor-pointer rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{cat.label}</span>
            <Toggle
              checked={prefs[cat.key]}
              onChange={() => setPrefs({ ...prefs, [cat.key]: !prefs[cat.key] })}
            />
          </label>
        ))}
      </div>
      <button onClick={onSave} disabled={saving} className="btn-primary mt-4">
        {saving ? <Spinner size="sm" /> : t('common.save')}
      </button>
    </SettingsCard>
  );
}

// ============================================
// Preferences Section
// ============================================

function PreferencesSection({
  currency,
  setCurrency,
  saving,
  onSave,
  error,
  success,
}: {
  currency: string;
  setCurrency: (c: string) => void;
  saving: boolean;
  onSave: () => void;
  error: string | null;
  success: boolean;
}) {
  const { t } = useLanguage();
  return (
    <SettingsCard title={t('settings.currency')} icon={<Globe className="h-5 w-5" />}>
      {success && <SuccessAlert message={t('settings.currencySaved')} />}
      {error && <ErrorAlert message={error} />}
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t('settings.currencyDesc')}</p>
      <div className="space-y-2">
        <label className="flex items-center gap-3 cursor-pointer rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800">
          <input type="radio" name="currency" value="USD" checked={currency === 'USD'} onChange={() => setCurrency('USD')} className="h-4 w-4 text-primary-600" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('settings.currencyUSD')}</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800">
          <input type="radio" name="currency" value="EGP" checked={currency === 'EGP'} onChange={() => setCurrency('EGP')} className="h-4 w-4 text-primary-600" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('settings.currencyEGP')}</span>
        </label>
      </div>
      <button onClick={onSave} disabled={saving} className="btn-primary mt-4">
        {saving ? <Spinner size="sm" /> : t('common.save')}
      </button>
    </SettingsCard>
  );
}

// ============================================
// Activity & Requests Section
// ============================================

function ActivitySection({
  requests,
  loading,
  error,
  onRetry,
}: {
  requests: UserRequest[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const { t } = useLanguage();
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={t('settings.noRequests')} onRetry={onRetry} retryLabel={t('common.retry')} />;
  if (requests.length === 0) return <EmptyState icon={<Clock className="h-8 w-8 text-slate-400" />} title={t('settings.noRequests')} />;

  return (
    <div className="space-y-4">
      {requests.map((req) => (
        <div key={req.id} className="card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900 dark:text-white">
                  {req.request_type === 'email_change' ? t('settings.requestTypeEmailChange')
                    : req.request_type === 'role_change' ? t('settings.requestTypeRoleChange')
                    : t('settings.requestTypeAccountDeletion')}
                </span>
                <RequestStatusBadge status={req.status} />
              </div>
              {req.requested_email && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('settings.emailChangeNewEmail')}: {req.requested_email}
                </p>
              )}
              {req.requested_role && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('settings.requestedRole')}: {t(`status.${req.requested_role}`)}
                </p>
              )}
              {req.reason && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('settings.requestReason')}: {req.reason}
                </p>
              )}
              {req.admin_reason && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('settings.requestAdminReason')}: {req.admin_reason}
                </p>
              )}
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {t('settings.requestDate')}: {new Date(req.created_at).toLocaleDateString()}
              </p>
              {req.reviewed_at && (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {t('settings.requestDecisionDate')}: {new Date(req.reviewed_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// Account Deletion Section
// ============================================

function DeletionSection({
  onRequestSubmitted,
}: {
  profile: NonNullable<ReturnType<typeof useAuth>['profile']>;
  onRequestSubmitted: () => void;
}) {
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    const { error: rpcError } = await supabase.rpc('request_account_deletion', { p_reason: reason || null });
    if (rpcError) {
      setError(rpcError.message);
    } else {
      setSuccess(true);
      setShowForm(false);
      setReason('');
      setTimeout(() => setSuccess(false), 3000);
      onRequestSubmitted();
    }
    setSubmitting(false);
  };

  return (
    <SettingsCard title={t('settings.deleteAccountTitle')} icon={<Trash2 className="h-5 w-5" />}>
      {success && <SuccessAlert message={t('settings.deleteAccountSuccess')} />}
      {error && <ErrorAlert message={error} />}
      <div className="rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 mb-4">
        <div className="flex gap-2 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p>{t('settings.deleteAccountWarning')}</p>
        </div>
      </div>
      {showForm ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.deleteAccountDesc')}</p>
          <div>
            <label className="label">{t('settings.deleteAccountReason')}</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input mt-1"
              rows={3}
              placeholder={t('settings.deleteAccountReasonPlaceholder')}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmit} disabled={submitting} className="btn-danger">
              {submitting ? <Spinner size="sm" /> : t('settings.deleteAccountSubmit')}
            </button>
            <button onClick={() => { setShowForm(false); setReason(''); setError(null); }} className="btn-secondary">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} className="btn-danger">
          <Trash2 className="h-4 w-4" />
          {t('settings.deleteAccountTitle')}
        </button>
      )}
    </SettingsCard>
  );
}

// ============================================
// Support Section
// ============================================

function SupportSection({
  loading,
  error,
  onOpen,
}: {
  loading: boolean;
  error: string | null;
  onOpen: () => void;
}) {
  const { t } = useLanguage();

  return (
    <SettingsCard title={t('support.contactSupport')} icon={<Headphones className="h-5 w-5" />}>
      {error && <ErrorAlert message={error} />}
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('support.contactSupportDesc')}</p>
      <div className="mt-4 rounded-lg bg-primary-50 dark:bg-primary-900/20 px-4 py-3">
        <div className="flex items-start gap-3">
          <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400" />
          <div>
            <p className="text-sm font-medium text-primary-700 dark:text-primary-300">{t('support.supportTeam')}</p>
            <p className="mt-1 text-xs text-primary-600 dark:text-primary-400">{t('support.welcomeUser')}</p>
          </div>
        </div>
      </div>
      <button onClick={onOpen} disabled={loading} className="btn-primary mt-4">
        {loading ? <Spinner size="sm" /> : <><Headphones className="h-4 w-4" /> {t('support.openConversation')}</>}
      </button>
    </SettingsCard>
  );
}

// ============================================
// Feedback Section
// ============================================

function FeedbackSection({ onOpen }: { onOpen: () => void }) {
  const { t } = useLanguage();
  return (
    <SettingsCard title={t('feedback.settingsEntry')} icon={<Lightbulb className="h-5 w-5" />}>
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('feedback.settingsDescription')}</p>
      <button onClick={onOpen} className="btn-primary mt-4">
        <Lightbulb className="h-4 w-4" />
        {t('feedback.settingsOpen')}
      </button>
    </SettingsCard>
  );
}

// ============================================
// Shared Components
// ============================================

function SettingsCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-primary-600 dark:text-primary-400">{icon}</span>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700 py-3 last:border-0">
      <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className="min-w-0 break-anywhere text-right text-sm font-medium text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

function RoleOption({ label, selected, onClick, disabled }: { label: string; selected: boolean; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors ${
        selected
          ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {label}
    </button>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6 rtl:-translate-x-6' : 'translate-x-1 rtl:-translate-x-1'}`} />
    </button>
  );
}

function RequestStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const config: Record<string, { icon: React.ReactNode; className: string }> = {
    pending: { icon: <ClockIcon className="h-3.5 w-3.5" />, className: 'badge-warning' },
    approved: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, className: 'badge-success' },
    rejected: { icon: <XCircle className="h-3.5 w-3.5" />, className: 'badge-error' },
  };
  const c = config[status] ?? config.pending;
  const statusLabels: Record<string, TranslationKey> = {
    pending: 'settings.requestStatusPending',
    approved: 'settings.requestStatusApproved',
    rejected: 'settings.requestStatusRejected',
  };
  return (
    <span className={`badge ${c.className} gap-1`}>
      {c.icon}
      {t(statusLabels[status] ?? 'settings.requestStatusPending')}
    </span>
  );
}

function SuccessAlert({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-lg bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-700 dark:text-green-300 animate-fade-in">
      {message}
    </div>
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 animate-fade-in">
      {message}
    </div>
  );
}

function LoadingState() {
  const { t } = useLanguage();
  return (
    <div className="flex items-center justify-center py-12">
      <Spinner size="lg" />
      <span className="ml-3 text-slate-500 dark:text-slate-400">{t('common.loading')}</span>
    </div>
  );
}
