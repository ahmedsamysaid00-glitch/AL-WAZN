import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/i18n/useLanguage';
import { LanguageSwitcher, ThemeToggle } from '@/components/shared/Navigation';
import { Spinner } from '@/components/ui/States';
import { Luggage, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { TranslationKey } from '@/i18n/translations';

export function ForgotPasswordPage() {
  const { t } = useLanguage();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('auth.emailRequired');
      return;
    }

    setSubmitting(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);

    if (err) {
      setError('auth.resetLinkFailed');
      return;
    }

    setSent(true);
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
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.forgotPasswordTitle')}</h1>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{t('auth.forgotPasswordSubtitle')}</p>
            </div>

            {error && (
              <div className="alert-error mb-4 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{t(error as TranslationKey)}</span>
              </div>
            )}

            {sent ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg bg-success-50 dark:bg-success-900/20 p-4">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-success-600 dark:text-success-400 mt-0.5" />
                  <p className="text-sm text-success-700 dark:text-success-300">
                    {t('auth.resetLinkSent')}
                  </p>
                </div>
                <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                  {t('auth.resetLinkCheckSpam')}
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="label">{t('auth.email')}</label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500 ltr:left-3.5 rtl:right-3.5" />
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="input ltr:pl-10 rtl:pr-10"
                      placeholder="you@example.com"
                      disabled={submitting}
                      autoFocus
                    />
                  </div>
                </div>

                <button type="submit" className="btn-primary w-full" disabled={submitting}>
                  {submitting ? <Spinner size="sm" /> : t('auth.sendResetLink')}
                </button>
              </form>
            )}

            <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
              <Link to="/login" className="font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                {t('auth.backToLogin')}
              </Link>
            </p>
          </div>

          <p className="mt-6 text-center">
            <Link to="/" className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
              {t('auth.backToHome')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
