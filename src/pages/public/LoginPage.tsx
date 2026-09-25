import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { LanguageSwitcher, ThemeToggle } from '@/components/shared/Navigation';
import { Spinner } from '@/components/ui/States';
import { Luggage, Mail, Lock, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { TranslationKey } from '@/i18n/translations';

export function LoginPage() {
  const { t } = useLanguage();
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string })?.from;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('auth.emailRequired');
      return;
    }
    if (!password) {
      setError('auth.passwordRequired');
      return;
    }

    setSubmitting(true);
    const { error: err } = await signIn(email.trim(), password);
    setSubmitting(false);

    if (err) {
      setError(err);
      return;
    }

    if (from) {
      navigate(from, { replace: true });
    } else {
      const { data: { session } } = await supabase.auth.getSession();
      let dest = '/dashboard';
      if (session?.user?.id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .maybeSingle();
        if (prof?.role === 'marketing') dest = '/marketing';
        else if (prof?.role === 'admin') dest = '/admin';
        else if (prof?.role === 'support') dest = '/support';
      }
      navigate(dest, { replace: true });
    }
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
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.loginTitle')}</h1>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{t('auth.loginSubtitle')}</p>
            </div>

            {error && (
              <div className="alert-error mb-4 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{t(error as TranslationKey)}</span>
              </div>
            )}

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
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="label">{t('auth.password')}</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500 ltr:left-3.5 rtl:right-3.5" />
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input ltr:pl-10 rtl:pr-10"
                    placeholder="••••••••"
                    disabled={submitting}
                  />
                </div>
                <div className="mt-1.5 text-end">
                  <Link to="/forgot-password" className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                    {t('auth.forgotPasswordLink')}
                  </Link>
                </div>
              </div>

              <button type="submit" className="btn-primary w-full" disabled={submitting}>
                {submitting ? <Spinner size="sm" /> : t('auth.loginButton')}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {t('auth.noAccount')}{' '}
              <Link to="/register" className="font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                {t('auth.signUpLink')}
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
