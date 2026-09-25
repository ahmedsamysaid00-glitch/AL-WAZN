import { useLanguage } from '@/i18n/useLanguage';
import { ThemeToggle, LanguageSwitcher } from '@/components/shared/Navigation';
import { Wrench } from 'lucide-react';

export function MaintenancePage() {
  const { t, dir } = useLanguage();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col" dir={dir}>
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white">
              <Wrench className="h-5 w-5" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="mx-auto max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 animate-pulse">
              <Wrench className="h-10 w-10" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">
            {t('maintenance.title')}
          </h1>
          <p className="mt-4 text-base text-slate-600 dark:text-slate-400">
            {t('maintenance.message')}
          </p>
          <div className="mt-8 rounded-lg bg-slate-100 dark:bg-slate-800 px-4 py-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('maintenance.supportEmailDesc')}
            </p>
            <p className="mt-1 text-sm font-medium text-primary-600 dark:text-primary-400" dir="ltr">
              ahmedsamysayed00@gmail.com
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 h-12 flex items-center justify-center">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {t('maintenance.title')}
          </p>
        </div>
      </footer>
    </div>
  );
}
