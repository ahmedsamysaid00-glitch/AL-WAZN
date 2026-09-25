import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/i18n/useTheme';
import { Languages, LogOut, User as UserIcon, Shield, Sun, Moon } from 'lucide-react';
import type { UserRole } from '@/types/database';
import type { TranslationKey } from '@/i18n/translations';

export function LanguageSwitcher() {
  const { lang, toggleLang } = useLanguage();
  return (
    <button
      onClick={toggleLang}
      className="btn-ghost btn-sm"
      aria-label="Switch language"
    >
      <Languages className="h-4 w-4" />
      <span className="hidden min-[400px]:inline">{lang === 'en' ? 'العربية' : 'English'}</span>
    </button>
  );
}

export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { t } = useLanguage();
  const isDark = resolvedTheme === 'dark';
  return (
    <button
      onClick={toggleTheme}
      className="btn-ghost btn-sm"
      aria-label={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
      title={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

interface UserMenuProps {
  variant?: 'user' | 'admin';
}

export function UserMenu({ variant = 'user' }: UserMenuProps) {
  void variant;
  const { profile, signOut } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const roleLabel = profile ? roleToLabel(profile.role, t) : '';

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <div className="flex items-center gap-2 sm:gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-primary-700 dark:text-primary-300">
          {profile?.role === 'admin' ? (
            <Shield className="h-4 w-4" />
          ) : (
            <UserIcon className="h-4 w-4" />
          )}
        </div>
        <div className="hidden sm:block">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-tight">
            {profile?.full_name || profile?.email}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{roleLabel}</p>
        </div>
      </div>
      <button
        onClick={() => signOut().then(() => navigate('/'))}
        className="btn-ghost btn-sm"
        aria-label={t('nav.logout')}
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">{t('nav.logout')}</span>
      </button>
    </div>
  );
}

function roleToLabel(role: UserRole, t: (key: TranslationKey) => string): string {
  switch (role) {
    case 'traveler':
      return t('status.traveler');
    case 'sender':
      return t('status.sender');
    case 'admin':
      return t('status.admin');
    case 'marketing':
      return t('status.marketing');
    default:
      return role;
  }
}

