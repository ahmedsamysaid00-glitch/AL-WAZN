import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useLanguage } from '@/i18n/useLanguage';
import { LanguageSwitcher, UserMenu, ThemeToggle } from '@/components/shared/Navigation';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Plane,
  Package,
  Handshake,
  MessageSquare,
  Bell,
  FileText,
  Settings,
  Luggage,
  Menu,
  X,
  ClipboardList,
  CreditCard,
  Percent,
  RotateCcw,
  Inbox,
  Megaphone,
  Lightbulb,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';

interface NavItem {
  to: string;
  labelKey: TranslationKey;
  icon: ReactNode;
}

const navItems: NavItem[] = [
  { to: '/admin', labelKey: 'nav.overview', icon: <LayoutDashboard className="h-5 w-5" /> },
  { to: '/admin/users', labelKey: 'nav.users', icon: <Users className="h-5 w-5" /> },
  { to: '/admin/verification', labelKey: 'nav.verification', icon: <ShieldCheck className="h-5 w-5" /> },
  { to: '/admin/travelers', labelKey: 'nav.travelers', icon: <Plane className="h-5 w-5" /> },
  { to: '/admin/senders', labelKey: 'nav.senders', icon: <Package className="h-5 w-5" /> },
  { to: '/admin/trips', labelKey: 'nav.trips', icon: <Plane className="h-5 w-5" /> },
  { to: '/admin/shipments', labelKey: 'nav.shipments', icon: <Package className="h-5 w-5" /> },
  { to: '/admin/products', labelKey: 'nav.products', icon: <Package className="h-5 w-5" /> },
  { to: '/admin/collaborations', labelKey: 'nav.collaborations', icon: <Handshake className="h-5 w-5" /> },
  { to: '/admin/orders', labelKey: 'nav.orders', icon: <ClipboardList className="h-5 w-5" /> },
  { to: '/admin/payments', labelKey: 'nav.payments', icon: <CreditCard className="h-5 w-5" /> },
  { to: '/admin/fees', labelKey: 'nav.fees', icon: <Percent className="h-5 w-5" /> },
  { to: '/admin/refunds', labelKey: 'nav.refunds', icon: <RotateCcw className="h-5 w-5" /> },
  { to: '/admin/marketing', labelKey: 'nav.adminMarketing', icon: <Megaphone className="h-5 w-5" /> },
  { to: '/admin/messages', labelKey: 'nav.messages', icon: <MessageSquare className="h-5 w-5" /> },
  { to: '/admin/notifications', labelKey: 'nav.notifications', icon: <Bell className="h-5 w-5" /> },
  { to: '/admin/audit-logs', labelKey: 'nav.auditLogs', icon: <FileText className="h-5 w-5" /> },
  { to: '/admin/requests', labelKey: 'admin.requests', icon: <Inbox className="h-5 w-5" /> },
  { to: '/admin/feedback', labelKey: 'nav.feedback', icon: <Lightbulb className="h-5 w-5" /> },
  { to: '/admin/settings', labelKey: 'nav.settings', icon: <Settings className="h-5 w-5" /> },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const { t, dir } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-700 bg-slate-900 dark:bg-slate-950 text-white">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-300 dark:text-slate-600 hover:bg-slate-800 dark:hover:bg-slate-700 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white">
                <Luggage className="h-5 w-5" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-bold text-white">{t('brand.name')}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">{t('admin.title')}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            <UserMenu variant="admin" />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl">
        {/* Desktop sidebar */}
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 overflow-y-auto border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 lg:block">
          <nav className="flex flex-col gap-0.5 p-3">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/admin'}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:text-white'
                  }`
                }
              >
                {item.icon}
                {t(item.labelKey)}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-slate-900 dark:bg-slate-950/50 animate-fade-in"
              onClick={() => setMobileOpen(false)}
            />
            <div className={`absolute top-0 h-full w-72 max-w-[85%] overflow-y-auto bg-white dark:bg-slate-800 shadow-xl animate-slide-in ${
              dir === 'rtl' ? 'right-0' : 'left-0'
            }`}>
              <div className="flex h-16 items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4">
                <span className="font-bold text-slate-900 dark:text-white">{t('admin.title')}</span>
                <button onClick={() => setMobileOpen(false)} className="btn-ghost btn-sm">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex flex-col gap-0.5 p-3">
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/admin'}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:text-white'
                      }`
                    }
                  >
                    {item.icon}
                    {t(item.labelKey)}
                  </NavLink>
                ))}
              </nav>
            </div>
          </div>
        )}

        {/* Main content */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
