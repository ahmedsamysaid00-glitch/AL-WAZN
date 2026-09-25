import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { LanguageSwitcher, ThemeToggle } from '@/components/shared/Navigation';
import { Spinner } from '@/components/ui/States';
import { Luggage, Mail, Lock, User as UserIcon, AlertCircle, Plane, Package, Check, Eye, EyeOff } from 'lucide-react';
import type { UserRole } from '@/types/database';
import type { TranslationKey } from '@/i18n/translations';

export function RegisterPage() {
  const { t } = useLanguage();
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const initialRole = searchParams.get('role') === 'traveler' ? 'traveler' : 'sender';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<UserRole>(initialRole);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError('auth.nameRequired');
      return;
    }
    if (!email.trim()) {
      setError('auth.emailRequired');
      return;
    }
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
    const { error: err } = await signUp(email.trim(), password, fullName.trim(), role);
    setSubmitting(false);

    if (err) {
      setError(err);
      return;
    }

    navigate('/dashboard', { replace: true });
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
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.registerTitle')}</h1>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{t('auth.registerSubtitle')}</p>
            </div>

            {error && (
              <div className="alert-error mb-4 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{t(error as TranslationKey)}</span>
              </div>
            )}

            {/* Role selector */}
            <div className="mb-5">
              <label className="label">{t('auth.role')}</label>
              <div className="grid grid-cols-2 gap-3">
                <RoleCard
                  selected={role === 'traveler'}
                  onClick={() => setRole('traveler')}
                  icon={<Plane className="h-5 w-5" />}
                  title={t('auth.roleTraveler')}
                  desc={t('auth.roleTravelerDesc')}
                />
                <RoleCard
                  selected={role === 'sender'}
                  onClick={() => setRole('sender')}
                  icon={<Package className="h-5 w-5" />}
                  title={t('auth.roleSender')}
                  desc={t('auth.roleSenderDesc')}
                />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="fullName" className="label">{t('auth.fullName')}</label>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500 ltr:left-3.5 rtl:right-3.5" />
                  <input
                    id="fullName"
                    type="text"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="input ltr:pl-10 rtl:pr-10"
                    placeholder="Ahmed Ali"
                    disabled={submitting}
                  />
                </div>
              </div>

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
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input ltr:pl-10 ltr:pr-10 rtl:pr-10 rtl:pl-10"
                    placeholder="••••••••"
                    disabled={submitting}
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
                {submitting ? <Spinner size="sm" /> : t('auth.registerButton')}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {t('auth.hasAccount')}{' '}
              <Link to="/login" className="font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                {t('auth.signInLink')}
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

interface RoleCardProps {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}

function RoleCard({ selected, onClick, icon, title, desc }: RoleCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-lg border p-4 text-start transition-all ${
        selected
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 ring-2 ring-primary-500/20'
          : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-500'
      }`}
    >
      {selected && (
        <div className="absolute top-2 ltr:right-2 rtl:left-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-white">
            <Check className="h-3 w-3" />
          </div>
        </div>
      )}
      <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${
        selected ? 'bg-primary-100 text-primary-700 dark:text-primary-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
      }`}>
        {icon}
      </div>
      <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{desc}</p>
    </button>
  );
}
