import { Link } from 'react-router-dom';
import { useLanguage } from '@/i18n/useLanguage';
import { LanguageSwitcher, ThemeToggle } from '@/components/shared/Navigation';
import {
  Plane,
  Package,
  ShieldCheck,
  MessageSquare,
  MapPin,
  ArrowRight,
  CheckCircle2,
  Luggage,
  Send,
} from 'lucide-react';

export function HomePage() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white">
              <Luggage className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              {t('brand.name')}
            </span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            <Link to="/trips" className="btn-ghost btn-sm hidden md:inline-flex">
              {t('discover.tripsTitle')}
            </Link>
            <Link to="/shipments" className="btn-ghost btn-sm hidden md:inline-flex">
              {t('discover.shipmentsTitle')}
            </Link>
            <Link to="/login" className="btn-ghost btn-sm">
              {t('nav.login')}
            </Link>
            <Link to="/register" className="btn-primary btn-sm">
              {t('nav.register')}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-50 via-white to-accent-50 dark:from-primary-900 dark:via-slate-900 dark:to-accent-900" />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl text-center animate-slide-up">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 dark:bg-primary-900/30 px-4 py-1.5 text-sm font-medium text-primary-700 dark:text-primary-300">
              <ShieldCheck className="h-4 w-4" />
              {t('home.trustTitle')}
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-5xl">
              {t('home.heroTitle')}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
              {t('home.heroSubtitle')}
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                to="/register?role=traveler"
                className="btn-primary btn-lg w-full sm:w-auto"
              >
                <Plane className="h-5 w-5" />
                {t('home.ctaTraveler')}
                <ArrowRight className={`h-4 w-4 ${arrow}`} />
              </Link>
              <Link
                to="/register?role=sender"
                className="btn-secondary btn-lg w-full sm:w-auto"
              >
                <Package className="h-5 w-5" />
                {t('home.ctaSender')}
                <ArrowRight className={`h-4 w-4 ${arrow}`} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Traveler / Sender cards */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="card card-hover p-8 animate-slide-up">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-100 text-primary-700 dark:text-primary-300">
              <Plane className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 dark:text-white">{t('home.travelerTitle')}</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{t('home.travelerDesc')}</p>
            <Link
              to="/register?role=traveler"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
            >
              {t('nav.register')}
              <ArrowRight className={`h-4 w-4 ${arrow}`} />
            </Link>
          </div>

          <div className="card card-hover p-8 animate-slide-up" style={{ animationDelay: '0.1s' }}>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-secondary-100 text-secondary-700 dark:text-secondary-300">
              <Package className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 dark:text-white">{t('home.senderTitle')}</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{t('home.senderDesc')}</p>
            <Link
              to="/register?role=sender"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-secondary-600 dark:text-secondary-400 hover:text-secondary-700 dark:hover:text-secondary-300"
            >
              {t('nav.register')}
              <ArrowRight className={`h-4 w-4 ${arrow}`} />
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-white dark:bg-slate-800 border-y border-slate-200 dark:border-slate-700">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-2xl font-bold text-slate-900 dark:text-slate-100 sm:text-3xl">
            {t('home.howItWorks')}
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              { icon: <UserIcon />, title: t('home.step1Title'), desc: t('home.step1Desc') },
              { icon: <MapPin />, title: t('home.step2Title'), desc: t('home.step2Desc') },
              { icon: <Send />, title: t('home.step3Title'), desc: t('home.step3Desc') },
            ].map((step, i) => (
              <div key={i} className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400">
                  {step.icon}
                </div>
                <div className="mb-2 text-sm font-bold text-accent-600 dark:text-accent-400">{`0${i + 1}`}</div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{step.title}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust section */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="card overflow-hidden bg-gradient-to-br from-primary-700 to-primary-900 p-8 sm:p-12 text-center">
          <ShieldCheck className="mx-auto h-12 w-12 text-primary-200" />
          <h2 className="mt-4 text-2xl font-bold text-white">{t('home.trustTitle')}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-primary-100">{t('home.trustDesc')}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-primary-100">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-5 w-5 text-secondary-300" />
              <span>{t('nav.verification')}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-5 w-5 text-secondary-300" />
              <MessageSquare className="h-4 w-4" />
              <span>{t('nav.messages')}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-5 w-5 text-secondary-300" />
              <MapPin className="h-4 w-4" />
              <span>{t('nav.notifications')}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white">
                <Luggage className="h-4 w-4" />
              </div>
              <span className="font-bold text-slate-900 dark:text-white">{t('brand.name')}</span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('brand.tagline')}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function UserIcon() {
  return (
    <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}
