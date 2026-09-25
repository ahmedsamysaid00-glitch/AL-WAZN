import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/i18n/useLanguage';
import { LanguageSwitcher, ThemeToggle } from '@/components/shared/Navigation';
import { Spinner } from '@/components/ui/States';
import { Luggage, Lock, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { TranslationKey } from '@/i18n/translations';

export function ResetPasswordPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [invalidLink, setInvalidLink] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;

      if (!session) {
        setInvalidLink(true);
      }
      setVerifying(false);
    };

    checkSession();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      if (cancelled) return;
      if (s?.user) {
        setInvalidLink(false);
        setVerifying(false);
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError('auth.passwordRequired');
      return;
    }
    if (password.length < 8) {
      setError('auth.passwordTooShort');
      return;
    }
    if (password !== confirmPassword) {
      setError('auth.passwordMismatch');
      return;
    }

    setSubmitting(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (err) {
      setError('auth.resetFailed');
      return;
    }

    setSuccess(true);
    setTimeout(() => navigate('/login', { replace: true }), 2500);
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-900">
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white">
              <Luggage className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold text-slate-900 dark:text-white">{t('brand.name')}</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md animate-slide-up">
          <div className="card p-8">
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.resetPasswordTitle')}</h1>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{t('auth.resetPasswordSubtitle')}</p>
            </div>

            {error && (
              <div className="alert-error mb-4 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{t(error as TranslationKey)}</span>
              </div>
            )}

            {verifying ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size="md" />
              </div>
            ) : invalidLink ? (
              <div className="space-y-4">
                <div className="alert-error flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 shrink-0 text-error-500 mt-0.5" />
                  <p className="text-sm text-error-700 dark:text-error-400">
                    {t('auth.invalidRecoveryLink')}
                  </p>
                </div>
                <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                  {t('auth.invalidRecoveryLinkDesc')}
                </p>
              </div>
            ) : success ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg bg-success-50 dark:bg-success-900/20 p-4">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-success-600 dark:text-success-400 mt-0.5" />
                  <p className="text-sm text-success-700 dark:text-success-300">
                    {t('auth.passwordUpdated')}
                  </p>
                </div>
                <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                  {t('auth.redirectingToLogin')}
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="password" className="label">{t('auth.newPassword')}</label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500 ltr:left-3.5 rtl:right-3.5" />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input ltr:pl-10 ltr:pr-10 rtl:pr-10 rtl:pl-10"
                      placeholder="••••••••"
                      disabled={submitting}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors ltr:right-3.5 rtl:left-3.5"
                      aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                      tabIndex={0}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="label">{t('auth.confirmPassword')}</label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500 ltr:left-3.5 rtl:right-3.5" />
                    <input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="input ltr:pl-10 ltr:pr-10 rtl:pr-10 rtl:pl-10"
                      placeholder="••••••••"
                      disabled={submitting}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((s) => !s)}
                      className="absolute top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors ltr:right-3.5 rtl:left-3.5"
                      aria-label={showConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                      tabIndex={0}
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <button type="submit" className="btn-primary w-full" disabled={submitting}>
                  {submitting ? <Spinner size="sm" /> : t('auth.updatePassword')}
                </button>
              </form>
            )}

            <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
              <Link to="/login" className="font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                {t('auth.backToLogin')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
