import { Link } from 'react-router-dom';
import { useLanguage } from '@/i18n/useLanguage';
import { useAuth } from '@/auth/useAuth';
import { LanguageSwitcher } from '@/components/shared/Navigation';
import { ShieldX, Home, LayoutDashboard, Luggage } from 'lucide-react';

export function AccessDeniedPage() {
  const { t } = useLanguage();
  const { profile } = useAuth();

  const dashboardLink = profile?.role === 'admin' ? '/admin' : profile?.role === 'marketing' ? '/marketing' : '/dashboard';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 px-4 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-error-50 text-error-500">
        <ShieldX className="h-10 w-10" />
      </div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('error.accessDenied')}</h1>
      <p className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">{t('error.accessDeniedDesc')}</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link to="/" className="btn-secondary">
          <Home className="h-4 w-4" />
          {t('error.goHome')}
        </Link>
        <Link to={dashboardLink} className="btn-primary">
          <LayoutDashboard className="h-4 w-4" />
          {t('error.goDashboard')}
        </Link>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useLanguage();

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
          <LanguageSwitcher />
        </div>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <p className="text-6xl font-bold text-slate-200 dark:text-slate-700">404</p>
        <h1 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">{t('error.notFound')}</h1>
        <p className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">{t('error.notFoundDesc')}</p>
        <Link to="/" className="btn-primary mt-8">
          <Home className="h-4 w-4" />
          {t('error.goHome')}
        </Link>
      </div>
    </div>
  );
}
