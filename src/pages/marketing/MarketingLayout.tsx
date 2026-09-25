import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { LanguageSwitcher, UserMenu, ThemeToggle } from '@/components/shared/Navigation';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import {
  LayoutDashboard,
  PackageCheck,
  Bell,
  User as UserIcon,
  ShieldCheck,
  Settings,
  Megaphone,
  Menu,
  X,
  UserPlus,
  BarChart3,
  Wrench,
  DollarSign,
  Wallet,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';

interface NavItem {
  to: string;
  labelKey: TranslationKey;
  icon: ReactNode;
  badgeKey?: 'notifications';
  end?: boolean;
}

const navItems: NavItem[] = [
  { to: '/marketing', labelKey: 'nav.overview', icon: <LayoutDashboard className="h-5 w-5" />, end: true },
  { to: '/marketing/referrals', labelKey: 'marketing.referralsTitle', icon: <UserPlus className="h-5 w-5" /> },
  { to: '/marketing/analytics', labelKey: 'marketing.analyticsTitle', icon: <BarChart3 className="h-5 w-5" /> },
  { to: '/marketing/tools', labelKey: 'marketing.toolsTitle', icon: <Wrench className="h-5 w-5" /> },
  { to: '/marketing/commissions', labelKey: 'marketing.commissionsTitle', icon: <DollarSign className="h-5 w-5" /> },
  { to: '/marketing/payouts', labelKey: 'marketing.payoutsTitle', icon: <Wallet className="h-5 w-5" /> },
  { to: '/marketing/completed-orders', labelKey: 'nav.completedOrders', icon: <PackageCheck className="h-5 w-5" /> },
  { to: '/marketing/notifications', labelKey: 'nav.notifications', icon: <Bell className="h-5 w-5" />, badgeKey: 'notifications' },
  { to: '/marketing/profile', labelKey: 'nav.profile', icon: <UserIcon className="h-5 w-5" /> },
  { to: '/marketing/verification', labelKey: 'nav.verification', icon: <ShieldCheck className="h-5 w-5" /> },
  { to: '/marketing/settings', labelKey: 'nav.settings', icon: <Settings className="h-5 w-5" /> },
];

const TRAVELER_SENDER_NOTIF_TYPES = [
  'collaboration_request', 'collaboration_accepted', 'collaboration_rejected',
  'order_awaiting_payment',
  'payment_pending', 'payment_paid', 'payment_failed',
  'payment_refund_requested', 'payment_refunded', 'payment_cancelled',
  'payment_completed', 'payment_refund_rejected', 'payment_held',
  'payment_released', 'payment_receipt_uploaded', 'payment_receipt_approved',
  'payment_receipt_rejected',
  'shipment_in_transit', 'shipment_delivered', 'receipt_confirmed',
];

export function MarketingLayout({ children }: { children: ReactNode }) {
  const { t, dir } = useLanguage();
  const { profile } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const fetchUnreadCount = useCallback(async () => {
    if (!profile?.id) return;
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .eq('is_read', false)
      .not('type', 'in', `(${TRAVELER_SENDER_NOTIF_TYPES.map((x) => `'${x}'`).join(',')})`);
    setUnreadNotifications(count ?? 0);
  }, [profile?.id]);

  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  useRealtimeRefresh(
    [{ table: 'notifications', filter: `user_id=eq.${profile?.id ?? ''}` }],
    () => fetchUnreadCount(),
    !!profile?.id,
  );

  const renderNavItem = (item: NavItem, onClick?: () => void) => {
    const badge = item.badgeKey === 'notifications' ? unreadNotifications : 0;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        onClick={onClick}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            isActive
              ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
          }`
        }
      >
        {item.icon}
        <span className="flex-1">{t(item.labelKey)}</span>
        {badge > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-xs font-bold text-white">
            {badge}
          </span>
        )}
      </NavLink>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="btn-ghost btn-sm lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white">
                <Megaphone className="h-5 w-5" />
              </div>
              <span className="text-lg font-bold text-slate-900 dark:text-white">{t('brand.name')}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            <UserMenu variant="user" />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 lg:block">
          <nav className="flex flex-col gap-1 p-4">
            {navItems.map((item) => renderNavItem(item))}
          </nav>
        </aside>

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
                <span className="font-bold text-slate-900 dark:text-white">{t('marketing.title')}</span>
                <button onClick={() => setMobileOpen(false)} className="btn-ghost btn-sm">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex flex-col gap-1 p-4">
                {navItems.map((item) => renderNavItem(item, () => setMobileOpen(false)))}
              </nav>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
