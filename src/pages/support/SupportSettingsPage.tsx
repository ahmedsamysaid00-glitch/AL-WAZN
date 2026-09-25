import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/i18n/useTheme';
import type { TranslationKey } from '@/i18n/translations';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui/States';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  User as UserIcon,
  Mail,
  KeyRound,
  Bell,
  Palette,
  Shield,
  LogOut,
  CheckCircle2,
  XCircle,
  Globe,
  Sun,
  Moon,
  Monitor,
  type LucideIcon,
} from 'lucide-react';
import { SupportLayout } from './SupportLayout';

type Section = 'account' | 'email' | 'password' | 'notifications' | 'appearance' | 'security';

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

export function SupportSettingsPage() {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const { theme, setTheme } = useTheme();
  const [activeSection, setActiveSection] = useState<Section>('account');

  const [notifPrefs, setNotifPrefs] = useState<NotifPref>(DEFAULT_PREFS);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [prefsSuccess, setPrefsSuccess] = useState(false);

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
    fetchPrefs();
  }, [fetchPrefs]);

  if (!profile) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
        <span className="ms-3 text-slate-500 dark:text-slate-400">{t('common.loading')}</span>
      </div>
    );
  }

  const sections: { key: Section; label: string; icon: React.ReactNode }[] = [
    { key: 'account', label: t('support.settingsAccount'), icon: <UserIcon className="h-5 w-5" /> },
    { key: 'email', label: t('support.settingsEmail'), icon: <Mail className="h-5 w-5" /> },
    { key: 'password', label: t('support.settingsPassword'), icon: <KeyRound className="h-5 w-5" /> },
    { key: 'notifications', label: t('support.settingsNotifications'), icon: <Bell className="h-5 w-5" /> },
    { key: 'appearance', label: t('support.settingsAppearance'), icon: <Palette className="h-5 w-5" /> },
    { key: 'security', label: t('support.settingsSecurity'), icon: <Shield className="h-5 w-5" /> },
  ];

  return (
    <SupportLayout>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('support.settingsTitle')}</h1>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
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

        <div className="flex-1 min-w-0">
          {activeSection === 'account' && <AccountSection profile={profile} />}
          {activeSection === 'email' && <EmailSection profile={profile} user={user} refreshProfile={refreshProfile} />}
          {activeSection === 'password' && <PasswordSection profile={profile} />}
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
                  setPrefsError(t('support.settingsNotifSaveFailed'));
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
          {activeSection === 'appearance' && (
            <AppearanceSection lang={lang} setLang={setLang} theme={theme} setTheme={setTheme} />
          )}
          {activeSection === 'security' && <SecuritySection profile={profile} signOut={signOut} />}
        </div>
      </div>
    </div>
    </SupportLayout>
  );
}

// ============================================
// Account Section
// ============================================

function AccountSection({ profile }: { profile: NonNullable<ReturnType<typeof useAuth>['profile']> }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-6">
      <SettingsCard title={t('support.settingsAccount')} icon={UserIcon}>
        <Field label={t('settings.fullName')} value={profile.full_name ?? '—'} />
        <Field label={t('settings.currentEmail')} value={profile.email} />
        <Field label={t('support.settingsRoleReadonly')} value={t('support.settingsRoleLabel')} />
        <Field label={t('settings.verificationStatus')} value={t(`verification.status.${profile.verification_status}` as TranslationKey)} />
        <Field label={t('settings.accountStatus')} value={t(`status.${profile.account_status}` as TranslationKey)} />
      </SettingsCard>
    </div>
  );
}

// ============================================
// Email Section
// ============================================

function EmailSection({
  profile,
  user,
  refreshProfile,
}: {
  profile: NonNullable<ReturnType<typeof useAuth>['profile']>;
  user: ReturnType<typeof useAuth>['user'];
  refreshProfile: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const currentEmail = user?.email ?? profile.email;

  const validate = (): string | null => {
    if (!newEmail.trim()) return t('support.settingsEmailRequired');
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!emailRegex.test(newEmail.trim())) return t('support.settingsEmailInvalid');
    if (newEmail.trim().toLowerCase() === currentEmail.toLowerCase()) return t('support.settingsEmailSameError');
    if (newEmail.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) return t('support.settingsEmailMismatch');
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setShowConfirm(true);
  };

  const performChange = async () => {
    setSubmitting(true);
    setError(null);
    setSuccess(false);

    const { error: updateError } = await supabase.auth.updateUser({ email: newEmail.trim() });

    if (updateError) {
      const msg = updateError.message.toLowerCase();
      if (msg.includes('rate') || msg.includes('limit')) {
        setError(t('support.settingsEmailRateLimit'));
      } else if (msg.includes('already') || msg.includes('registered') || msg.includes('in use')) {
        setError(t('support.settingsEmailInUse'));
      } else if (msg.includes('network') || msg.includes('fetch')) {
        setError(t('support.settingsEmailNetworkError'));
      } else {
        setError(t('support.settingsEmailNetworkError'));
      }
      setSubmitting(false);
      return;
    }

    await refreshProfile();
    setSuccess(true);
    setNewEmail('');
    setConfirmEmail('');
    setTimeout(() => setSuccess(false), 6000);
    setSubmitting(false);
  };

  return (
    <SettingsCard title={t('support.settingsChangeEmail')} icon={Mail}>
      {success && <SuccessAlert message={t('support.settingsEmailChangeSent')} />}
      {error && <ErrorAlert message={error} />}

      <Field label={t('settings.currentEmail')} value={currentEmail} />

      <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">{t('support.settingsChangeEmailDesc')}</p>

      <div className="space-y-4 mt-4">
        <div>
          <label className="label">{t('support.settingsNewEmail')}</label>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="input mt-1"
            placeholder="new@email.com"
            autoComplete="email"
          />
        </div>
        <div>
          <label className="label">{t('support.settingsConfirmEmail')}</label>
          <input
            type="email"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            className="input mt-1"
            placeholder="new@email.com"
            autoComplete="email"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting || !newEmail || !confirmEmail}
          className="btn-primary"
        >
          {submitting ? <Spinner size="sm" /> : (
            <>
              <Mail className="h-4 w-4" />
              {t('support.settingsChangeEmailBtn')}
            </>
          )}
        </button>
      </div>

      <ConfirmDialog
        open={showConfirm}
        title={t('settings.confirmTitle')}
        message={t('support.settingsEmailChangeConfirm')}
        confirmLabel={t('support.settingsChangeEmailBtn')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setShowConfirm(false);
          performChange();
        }}
        onCancel={() => setShowConfirm(false)}
        loading={submitting}
      />
    </SettingsCard>
  );
}

// ============================================
// Password Section
// ============================================

function PasswordSection({ profile }: { profile: NonNullable<ReturnType<typeof useAuth>['profile']> }) {
  const { t } = useLanguage();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleChangePassword = async () => {
    setError(null);
    setSuccess(false);

    if (newPassword.length < 8) {
      setError(t('support.settingsPasswordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('support.settingsPasswordMismatch'));
      return;
    }

    setSubmitting(true);

    // Re-authenticate to verify current password
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: currentPassword,
    });
    if (signInError) {
      setError(t('support.settingsPasswordCurrentWrong'));
      setSubmitting(false);
      return;
    }

    // Update password via official Supabase Auth API
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      setError(t('support.settingsPasswordError'));
      setSubmitting(false);
      return;
    }

    // Log to audit via existing RPC (no sensitive data passed)
    await supabase.rpc('change_password', {
      p_current_password: '',
      p_new_password: '',
    });

    setSuccess(true);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setTimeout(() => setSuccess(false), 3000);
    setSubmitting(false);
  };

  return (
    <SettingsCard title={t('support.settingsChangePassword')} icon={KeyRound}>
      {success && <SuccessAlert message={t('support.settingsPasswordSuccess')} />}
      {error && <ErrorAlert message={error} />}
      <div className="space-y-4">
        <div>
          <label className="label">{t('support.settingsCurrentPassword')}</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="input mt-1"
            autoComplete="current-password"
          />
        </div>
        <div>
          <label className="label">{t('support.settingsNewPassword')}</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="input mt-1"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="label">{t('support.settingsConfirmPassword')}</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="input mt-1"
            autoComplete="new-password"
          />
        </div>
        <button
          onClick={handleChangePassword}
          disabled={submitting || !currentPassword || !newPassword || !confirmPassword}
          className="btn-primary"
        >
          {submitting ? <Spinner size="sm" /> : t('support.settingsPasswordSubmit')}
        </button>
      </div>
    </SettingsCard>
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

  // Support-relevant notification preferences
  const categories: { key: keyof NotifPref; label: string }[] = [
    { key: 'new_messages', label: t('support.settingsNotifNewMessages') },
    { key: 'system_notifications', label: t('support.settingsNotifSystem') },
  ];

  if (loading) {
    return (
      <SettingsCard title={t('support.settingsNotifications')} icon={Bell}>
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" />
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard title={t('support.settingsNotifications')} icon={Bell}>
      {success && <SuccessAlert message={t('support.settingsNotifSaved')} />}
      {error && <ErrorAlert message={error} />}
      <div className="space-y-3">
        {categories.map((cat) => (
          <label
            key={cat.key}
            className="flex items-center justify-between cursor-pointer rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
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
// Appearance Section
// ============================================

function AppearanceSection({
  lang,
  setLang,
  theme,
  setTheme,
}: {
  lang: 'en' | 'ar';
  setLang: (l: 'en' | 'ar') => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (t: 'light' | 'dark' | 'system') => void;
}) {
  const { t } = useLanguage();

  const themeOptions: { value: 'light' | 'dark' | 'system'; label: string; icon: LucideIcon }[] = [
    { value: 'light', label: t('theme.light'), icon: Sun },
    { value: 'dark', label: t('theme.dark'), icon: Moon },
    { value: 'system', label: t('theme.system'), icon: Monitor },
  ];

  return (
    <div className="space-y-6">
      <SettingsCard title={t('support.settingsLanguage')} icon={Globe}>
        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800">
            <input
              type="radio"
              name="language"
              value="en"
              checked={lang === 'en'}
              onChange={() => setLang('en')}
              className="h-4 w-4 text-primary-600"
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">English</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800">
            <input
              type="radio"
              name="language"
              value="ar"
              checked={lang === 'ar'}
              onChange={() => setLang('ar')}
              className="h-4 w-4 text-primary-600"
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">العربية</span>
          </label>
        </div>
      </SettingsCard>

      <SettingsCard title={t('support.settingsTheme')} icon={Palette}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {themeOptions.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 px-4 py-4 text-sm font-medium transition-colors ${
                  theme === opt.value
                    ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <Icon className="h-5 w-5" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </SettingsCard>
    </div>
  );
}

// ============================================
// Security Section
// ============================================

function SecuritySection({
  profile,
  signOut,
}: {
  profile: NonNullable<ReturnType<typeof useAuth>['profile']>;
  signOut: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [signingOut, setSigningOut] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [signOutAllSuccess, setSignOutAllSuccess] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
  };

  const handleSignOutAll = async () => {
    setSigningOutAll(true);
    await supabase.auth.signOut({ scope: 'others' });
    setSignOutAllSuccess(true);
    setTimeout(() => setSignOutAllSuccess(false), 3000);
    setSigningOutAll(false);
  };

  const lastSignIn = profile.created_at ? new Date(profile.created_at).toLocaleDateString() : '—';

  return (
    <div className="space-y-6">
      <SettingsCard title={t('support.settingsSecurity')} icon={Shield}>
        <Field label={t('support.settingsLastSignIn')} value={lastSignIn} />
        <Field label={t('settings.currentEmail')} value={profile.email} />
      </SettingsCard>

      <SettingsCard title={t('support.settingsSignOutAll')} icon={LogOut}>
        {signOutAllSuccess && <SuccessAlert message={t('support.settingsSignOutAllSuccess')} />}
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('support.settingsSignOutAllDesc')}</p>
        <button onClick={handleSignOutAll} disabled={signingOutAll} className="btn-secondary mt-3">
          {signingOutAll ? <Spinner size="sm" /> : (
            <>
              <LogOut className="h-4 w-4" />
              {t('support.settingsSignOutAll')}
            </>
          )}
        </button>
      </SettingsCard>

      <SettingsCard title={t('support.settingsSignOut')} icon={LogOut}>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('support.settingsSignOutDesc')}</p>
        <button onClick={handleSignOut} disabled={signingOut} className="btn-primary bg-error-600 hover:bg-error-700 mt-3">
          {signingOut ? <Spinner size="sm" /> : (
            <>
              <LogOut className="h-4 w-4" />
              {t('support.settingsSignOut')}
            </>
          )}
        </button>
      </SettingsCard>
    </div>
  );
}

// ============================================
// Shared Components
// ============================================

function SettingsCard({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-primary-600 dark:text-primary-400">
          <Icon className="h-5 w-5" />
        </span>
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
      <span className="min-w-0 break-anywhere text-start text-sm font-medium text-slate-900 dark:text-white">{value}</span>
    </div>
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

function SuccessAlert({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-lg bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-700 dark:text-green-300 animate-fade-in">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        {message}
      </div>
    </div>
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 animate-fade-in">
      <div className="flex items-center gap-2">
        <XCircle className="h-4 w-4 shrink-0" />
        {message}
      </div>
    </div>
  );
}
