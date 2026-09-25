import { useState, useEffect, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { LanguageSwitcher, UserMenu, ThemeToggle } from '@/components/shared/Navigation';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import {
  LayoutDashboard,
  User as UserIcon,
  Plane,
  Package,
  Handshake,
  MessageSquare,
  Bell,
  Settings,
  Luggage,
  Menu,
  X,
  Shield,
  ShieldCheck,
  ClipboardList,
  CreditCard,
  Wallet,
  Compass,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { UserRole } from '@/types/database';

interface NavItem {
  to: string;
  labelKey: TranslationKey;
  icon: ReactNode;
  badgeKey?: 'messages' | 'notifications';
  roles?: UserRole[];
}

const navItems: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.overview', icon: <LayoutDashboard className="h-5 w-5" /> },
  { to: '/dashboard/profile', labelKey: 'nav.profile', icon: <UserIcon className="h-5 w-5" /> },
  { to: '/dashboard/verification', labelKey: 'nav.verification', icon: <ShieldCheck className="h-5 w-5" /> },
  { to: '/dashboard/trips', labelKey: 'nav.trips', icon: <Plane className="h-5 w-5" />, roles: ['traveler'] },
  { to: '/trips', labelKey: 'nav.discoverTrips', icon: <Compass className="h-5 w-5" />, roles: ['sender'] },
  { to: '/dashboard/shipments', labelKey: 'nav.shipments', icon: <Package className="h-5 w-5" />, roles: ['sender'] },
  { to: '/dashboard/collaborations', labelKey: 'nav.collaborations', icon: <Handshake className="h-5 w-5" /> },
  { to: '/dashboard/orders', labelKey: 'nav.orders', icon: <ClipboardList className="h-5 w-5" /> },
  { to: '/dashboard/payments', labelKey: 'nav.payments', icon: <CreditCard className="h-5 w-5" /> },
  { to: '/dashboard/wallet', labelKey: 'nav.wallet', icon: <Wallet className="h-5 w-5" /> },
  { to: '/dashboard/messages', labelKey: 'nav.messages', icon: <MessageSquare className="h-5 w-5" />, badgeKey: 'messages' },
  { to: '/dashboard/notifications', labelKey: 'nav.notifications', icon: <Bell className="h-5 w-5" />, badgeKey: 'notifications' },
  { to: '/dashboard/settings', labelKey: 'nav.settings', icon: <Settings className="h-5 w-5" /> },
];

export function UserLayout({ children }: { children: ReactNode }) {
  const { t, dir } = useLanguage();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const showAdminLink = profile?.role === 'admin';

  const visibleNavItems = navItems.filter(
    (item) => !item.roles || (profile?.role && item.roles.includes(profile.role))
  );

  // Fetch and subscribe to unread counts in realtime
  useEffect(() => {
    if (!profile?.id) return;

    const fetchCounts = async () => {
      // Unread messages: messages in conversations where user is participant, not sent by user, not read
      const { data: convs } = await supabase
        .from('conversations')
        .select('id')
        .or(`traveler_id.eq.${profile.id},sender_id.eq.${profile.id}`);
      const convIds = convs?.map((c: { id: string }) => c.id) ?? [];

      let msgCount = 0;
      if (convIds.length > 0) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .neq('sender_id', profile.id)
          .is('read_at', null)
          .in('conversation_id', convIds);
        msgCount = count ?? 0;
      }

      setUnreadMessages(msgCount);

      const { count: notifCount } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('is_read', false);
      setUnreadNotifications(notifCount ?? 0);
    };

    fetchCounts();
  }, [profile?.id]);

  useRealtimeRefresh(
    [
      { table: 'messages' },
      { table: 'notifications', filter: `user_id=eq.${profile?.id ?? ''}` },
      { table: 'conversations' },
    ],
    async () => {
      if (!profile?.id) return;
      const { data: convs } = await supabase
        .from('conversations')
        .select('id')
        .or(`traveler_id.eq.${profile.id},sender_id.eq.${profile.id}`);
      const convIds = convs?.map((c: { id: string }) => c.id) ?? [];
      let msgCount = 0;
      if (convIds.length > 0) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .neq('sender_id', profile.id)
          .is('read_at', null)
          .in('conversation_id', convIds);
        msgCount = count ?? 0;
      }
      setUnreadMessages(msgCount);
      const { count: notifCount } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('is_read', false);
      setUnreadNotifications(notifCount ?? 0);
    },
    !!profile?.id,
  );

  const badgeCount = (key?: 'messages' | 'notifications') => {
    if (key === 'messages') return unreadMessages;
    if (key === 'notifications') return unreadNotifications;
    return 0;
  };

  const renderNavItem = (item: NavItem, onClick?: () => void) => {
    const badge = badgeCount(item.badgeKey);
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/dashboard'}
        onClick={onClick}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            isActive
              ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:text-white'
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
      {/* Top bar */}
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
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white">
                <Luggage className="h-5 w-5" />
              </div>
              <span className="text-lg font-bold text-slate-900 dark:text-white">{t('brand.name')}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            {showAdminLink && (
              <button
                onClick={() => navigate('/admin')}
                className="btn-ghost btn-sm text-primary-600 dark:text-primary-400"
              >
                <Shield className="h-4 w-4" />
                <span className="hidden sm:inline">{t('nav.admin')}</span>
              </button>
            )}
            <LanguageSwitcher />
            <ThemeToggle />
            <UserMenu variant="user" />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl">
        {/* Desktop sidebar */}
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 lg:block">
          <nav className="flex flex-col gap-1 p-4">
            {visibleNavItems.map((item) => renderNavItem(item))}
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
                <span className="font-bold text-slate-900 dark:text-white">{t('dashboard.title')}</span>
                <button onClick={() => setMobileOpen(false)} className="btn-ghost btn-sm">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex flex-col gap-1 p-4">
                {visibleNavItems.map((item) => renderNavItem(item, () => setMobileOpen(false)))}
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
