import { useEffect, useCallback, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { UserLayout } from './UserLayout';
import { EmptyState, ErrorState } from '@/components/ui/States';
import {
  Package,
  Handshake,
  Plane,
  MessageSquare,
  Bell,
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ClipboardList,
  CreditCard,
  Wallet,
  Compass,
  Plus,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type {
  UserRole,
  AccountStatus,
  VerificationStatus,
  Notification,
  Conversation,
  OrderStatus,
  SenderListing,
  Collaboration,
  CollaborationStatus,
  ListingStatus,
} from '@/types/database';

// ── Section state types ──────────────────────────────────────
type LoadState = 'loading' | 'loaded' | 'error';

interface SectionStatus {
  state: LoadState;
}

interface ConversationPreview extends Conversation {
  collaborations?: {
    trips?: { origin: string; destination: string };
    sender_listings?: { product_name: string };
  };
}

type RecentShipment = Pick<SenderListing, 'id' | 'product_name' | 'origin' | 'destination' | 'status' | 'created_at'>;

interface RecentCollab extends Pick<Collaboration, 'id' | 'status' | 'proposed_price' | 'created_at'> {
  trips?: { origin: string; destination: string };
  sender_listings?: { product_name: string };
}

interface RecentOrderPreview {
  id: string;
  order_number: string;
  status: OrderStatus;
  created_at: string;
  trips?: { origin: string; destination: string };
  sender_listings?: { product_name: string };
}

// ── Skeleton helpers ─────────────────────────────────────────
function CardSkeleton() {
  return (
    <div className="card p-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-slate-200 dark:bg-slate-700" />
          <div className="space-y-2">
            <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>
        <div className="h-7 w-8 rounded bg-slate-200 dark:bg-slate-700" />
      </div>
    </div>
  );
}

function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-100 dark:border-slate-700 p-3 animate-pulse">
          <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-2.5 w-20 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Section wrapper ──────────────────────────────────────────
function DashboardSection({
  title,
  viewAllTo,
  viewAllLabel,
  loading,
  error,
  errorKey,
  onRetry,
  retryLabel,
  empty,
  emptyIcon,
  emptyTitle,
  emptyDesc,
  emptyAction,
  children,
}: {
  title: string;
  viewAllTo?: string;
  viewAllLabel?: string;
  loading?: boolean;
  error?: boolean;
  errorKey?: string;
  onRetry?: () => void;
  retryLabel?: string;
  empty?: boolean;
  emptyIcon?: React.ReactNode;
  emptyTitle?: string;
  emptyDesc?: string;
  emptyAction?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="card p-6 animate-slide-up">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
        {viewAllTo && viewAllLabel && !loading && !error && (
          <Link
            to={viewAllTo}
            className="text-sm font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 whitespace-nowrap"
          >
            {viewAllLabel}
          </Link>
        )}
      </div>
      {loading ? (
        children ? <ListSkeleton /> : <ListSkeleton />
      ) : error ? (
        <ErrorState message={errorKey ?? ''} onRetry={onRetry} retryLabel={retryLabel} />
      ) : empty ? (
        <EmptyState icon={emptyIcon} title={emptyTitle ?? ''} description={emptyDesc} action={emptyAction} />
      ) : (
        children
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────
export function UserDashboard() {
  const { t, dir } = useLanguage();
  const { profile, refreshProfile } = useAuth();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';

  // Overview / stats
  const [overviewStatus, setOverviewStatus] = useState<SectionStatus>({ state: 'loading' });
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [activeOrders, setActiveOrders] = useState(0);
  const [completedOrders, setCompletedOrders] = useState(0);
  const [pendingPayments, setPendingPayments] = useState(0);
  const [completedPayments, setCompletedPayments] = useState(0);
  const [walletBalance, setWalletBalance] = useState(0);

  // Shipments
  const [shipmentsStatus, setShipmentsStatus] = useState<SectionStatus>({ state: 'loading' });
  const [recentShipments, setRecentShipments] = useState<RecentShipment[]>([]);

  // Collaborations
  const [collabStatus, setCollabStatus] = useState<SectionStatus>({ state: 'loading' });
  const [recentCollabs, setRecentCollabs] = useState<RecentCollab[]>([]);

  // Orders
  const [ordersStatus, setOrdersStatus] = useState<SectionStatus>({ state: 'loading' });
  const [recentOrders, setRecentOrders] = useState<RecentOrderPreview[]>([]);

  // Conversations
  const [convStatus, setConvStatus] = useState<SectionStatus>({ state: 'loading' });
  const [recentConversations, setRecentConversations] = useState<ConversationPreview[]>([]);

  // Notifications
  const [notifStatus, setNotifStatus] = useState<SectionStatus>({ state: 'loading' });
  const [recentNotifications, setRecentNotifications] = useState<Notification[]>([]);

  // Track in-flight request to avoid duplicate concurrent fetches
  const fetchingRef = useRef(false);

  const isTraveler = profile?.role === 'traveler';

  const handleProfileUpdate = useCallback(() => {
    refreshProfile();
  }, [refreshProfile]);

  const fetchDashboardData = useCallback(async () => {
    if (!profile?.id || fetchingRef.current) return;
    fetchingRef.current = true;

    const uid = profile.id;

    // ── Overview / stats (all head/count queries in parallel) ──
    setOverviewStatus({ state: 'loading' });
    try {
      const [
        convIdsRes,
        notifCountRes,
        activeOrdersRes,
        completedOrdersRes,
        pendingPayRes,
        completedPayRes,
        walletRes,
      ] = await Promise.all([
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .or(`traveler_id.eq.${uid},sender_id.eq.${uid}`),
        supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', uid)
          .eq('is_read', false),
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .or(`traveler_id.eq.${uid},sender_id.eq.${uid}`)
          .in('status', ['pending', 'awaiting_payment', 'confirmed', 'in_transit', 'delivered', 'received']),
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .or(`traveler_id.eq.${uid},sender_id.eq.${uid}`)
          .eq('status', 'completed'),
        supabase
          .from('payments')
          .select('id', { count: 'exact', head: true })
          .or(`payer_id.eq.${uid},payee_id.eq.${uid}`)
          .in('status', ['pending', 'processing']),
        supabase
          .from('payments')
          .select('id', { count: 'exact', head: true })
          .or(`payer_id.eq.${uid},payee_id.eq.${uid}`)
          .eq('status', 'paid'),
        supabase
          .from('wallet_accounts')
          .select('available_balance')
          .eq('user_id', uid)
          .maybeSingle(),
      ]);

      // Unread messages — needs conversation IDs first
      let unreadMsgCount = 0;
      if (convIdsRes.data && convIdsRes.data.length > 0) {
        const convIdList = convIdsRes.data.map((c: { id: string }) => c.id);
        const { count: msgCount } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .neq('sender_id', uid)
          .is('read_at', null)
          .in('conversation_id', convIdList);
        unreadMsgCount = msgCount ?? 0;
      }

      setUnreadMessages(unreadMsgCount);
      setUnreadNotifications(notifCountRes.count ?? 0);
      setActiveOrders(activeOrdersRes.count ?? 0);
      setCompletedOrders(completedOrdersRes.count ?? 0);
      setPendingPayments(pendingPayRes.count ?? 0);
      setCompletedPayments(completedPayRes.count ?? 0);
      setWalletBalance(walletRes.data?.available_balance ?? 0);
      setOverviewStatus({ state: 'loaded' });
    } catch {
      setOverviewStatus({ state: 'error' });
    }

    // ── Shipments (sender listings) — sender only ──
    // ── Collaborations, orders, conversations, notifications ──
    // All section queries are independent of each other, so run them in parallel.
    setShipmentsStatus({ state: 'loading' });
    setCollabStatus({ state: 'loading' });
    setOrdersStatus({ state: 'loading' });
    setConvStatus({ state: 'loading' });
    setNotifStatus({ state: 'loading' });

    const [
      shipmentsRes,
      collabsRes,
      ordersRes,
      convsRes,
      notifsRes,
    ] = await Promise.all([
      isTraveler
        ? Promise.resolve({ data: null })
        : supabase
            .from('sender_listings')
            .select('id, product_name, origin, destination, status, created_at')
            .eq('sender_id', uid)
            .order('created_at', { ascending: false })
            .limit(3),
      supabase
        .from('collaborations')
        .select(`
          id, status, proposed_price, created_at,
          trips(origin, destination),
          sender_listings(product_name)
        `)
        .or(`traveler_id.eq.${uid},sender_id.eq.${uid}`)
        .order('created_at', { ascending: false })
        .limit(3),
      supabase
        .from('orders')
        .select(`
          id, order_number, status, created_at,
          trips(origin, destination),
          sender_listings(product_name)
        `)
        .or(`traveler_id.eq.${uid},sender_id.eq.${uid}`)
        .in('status', ['pending', 'awaiting_payment', 'confirmed', 'in_transit', 'delivered', 'received'])
        .order('created_at', { ascending: false })
        .limit(3),
      supabase
        .from('conversations')
        .select(`
          *,
          collaborations(
            trips(origin, destination),
            sender_listings(product_name)
          )
        `)
        .or(`traveler_id.eq.${uid},sender_id.eq.${uid}`)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(3),
      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(3),
    ]);

    if (!isTraveler) {
      setRecentShipments((shipmentsRes.data as RecentShipment[]) ?? []);
      setShipmentsStatus({ state: 'loaded' });
    } else {
      setShipmentsStatus({ state: 'loaded' });
    }

    setRecentCollabs((collabsRes.data as unknown as RecentCollab[]) ?? []);
    setCollabStatus({ state: 'loaded' });

    setRecentOrders((ordersRes.data as unknown as RecentOrderPreview[]) ?? []);
    setOrdersStatus({ state: 'loaded' });

    setRecentConversations((convsRes.data as unknown as ConversationPreview[]) ?? []);
    setConvStatus({ state: 'loaded' });

    setRecentNotifications((notifsRes.data as Notification[]) ?? []);
    setNotifStatus({ state: 'loaded' });

    fetchingRef.current = false;
  }, [profile?.id, isTraveler]);

  // Initial load + profile realtime
  useEffect(() => {
    if (!profile?.id) return;

    const channel = supabase
      .channel(`profile:${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${profile.id}` },
        () => handleProfileUpdate(),
      )
      .subscribe();

    fetchDashboardData();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, handleProfileUpdate, fetchDashboardData]);

  // Debounced realtime refresh — existing hook already debounces at 250ms
  useRealtimeRefresh(
    [
      { table: 'messages' },
      { table: 'notifications', filter: `user_id=eq.${profile?.id ?? ''}` },
      { table: 'conversations' },
      { table: 'orders' },
      { table: 'payments' },
      { table: 'wallet_accounts', filter: `user_id=eq.${profile?.id ?? ''}` },
      { table: 'sender_listings', filter: `sender_id=eq.${profile?.id ?? ''}` },
      { table: 'collaborations' },
    ],
    () => fetchDashboardData(),
    !!profile?.id,
  );

  const roleBadge = profile ? roleBadgeClass(profile.role) : 'badge-neutral';
  const statusBadge = profile ? statusBadgeClass(profile.account_status) : 'badge-neutral';
  const verificationStatus: VerificationStatus = profile?.verification_status ?? 'unverified';

  // Quick actions — role-aware
  const quickActions: { icon: LucideIcon; labelKey: TranslationKey; to: string }[] = isTraveler
    ? [
        { icon: Plus, labelKey: 'dashboard.createTrip', to: '/dashboard/trips/new' },
        { icon: Plane, labelKey: 'dashboard.viewTrips', to: '/dashboard/trips' },
        { icon: Handshake, labelKey: 'nav.collaborations', to: '/dashboard/collaborations' },
        { icon: ClipboardList, labelKey: 'dashboard.viewOrders', to: '/dashboard/orders' },
        { icon: MessageSquare, labelKey: 'dashboard.viewMessages', to: '/dashboard/messages' },
      ]
    : [
        { icon: Plus, labelKey: 'dashboard.createShipment', to: '/dashboard/shipments/new' },
        { icon: Package, labelKey: 'dashboard.viewShipments', to: '/dashboard/shipments' },
        { icon: Compass, labelKey: 'dashboard.browseTrips', to: '/trips' },
        { icon: ClipboardList, labelKey: 'dashboard.viewOrders', to: '/dashboard/orders' },
        { icon: MessageSquare, labelKey: 'dashboard.viewMessages', to: '/dashboard/messages' },
      ];

  return (
    <UserLayout>
      <div className="space-y-6">
        {/* Welcome */}
        <div className="animate-slide-up">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('dashboard.welcome')}, {profile?.full_name || profile?.email}
          </h1>
        </div>

        {/* Verification status card */}
        <VerificationCard status={verificationStatus} t={t} dir={dir} />

        {/* Account info card */}
        <div className="card p-6 animate-slide-up">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{t('dashboard.accountInfo')}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InfoField label={t('dashboard.role')}>
              <span className={roleBadge}>{profile ? roleLabel(profile.role, t) : '—'}</span>
            </InfoField>
            <InfoField label={t('dashboard.accountStatus')}>
              <span className={statusBadge}>{profile ? statusLabel(profile.account_status, t) : '—'}</span>
            </InfoField>
            <InfoField label={t('profile.email')}>
              <span className="text-sm text-slate-700 dark:text-slate-200 break-all">{profile?.email || '—'}</span>
            </InfoField>
            <InfoField label={t('dashboard.memberSince')}>
              <span className="text-sm text-slate-700 dark:text-slate-300">
                {profile ? new Date(profile.created_at).toLocaleDateString() : '—'}
              </span>
            </InfoField>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card p-6 animate-slide-up">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{t('dashboard.quickActions')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.to}
                  to={action.to}
                  className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-4 text-center transition-colors hover:border-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-semibold text-slate-900 dark:text-white">{t(action.labelKey)}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Overview / Statistics */}
        {overviewStatus.state === 'loading' ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : overviewStatus.state === 'error' ? (
          <div className="card p-6 animate-slide-up">
            <ErrorState
              message={t('dashboard.failedOverview')}
              onRetry={fetchDashboardData}
              retryLabel={t('common.retry')}
            />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Unread messages */}
            <Link to="/dashboard/messages" className="card card-hover p-6 animate-slide-up">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('dashboard.unreadMessages')}</h3>
                </div>
                <span className={`text-2xl font-bold ${unreadMessages > 0 ? 'text-primary-600 dark:text-primary-400' : 'text-slate-300 dark:text-slate-600'}`}>
                  {unreadMessages}
                </span>
              </div>
            </Link>

            {/* Unread notifications */}
            <Link to="/dashboard/notifications" className="card card-hover p-6 animate-slide-up" style={{ animationDelay: '0.05s' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-50 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400">
                    <Bell className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('dashboard.unreadNotifications')}</h3>
                </div>
                <span className={`text-2xl font-bold ${unreadNotifications > 0 ? 'text-accent-600 dark:text-accent-400' : 'text-slate-300 dark:text-slate-600'}`}>
                  {unreadNotifications}
                </span>
              </div>
            </Link>

            {/* Active orders */}
            <Link to="/dashboard/orders" className="card card-hover p-6 animate-slide-up" style={{ animationDelay: '0.1s' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
                    <ClipboardList className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('dashboard.activeOrders')}</h3>
                </div>
                <span className={`text-2xl font-bold ${activeOrders > 0 ? 'text-primary-600 dark:text-primary-400' : 'text-slate-300 dark:text-slate-600'}`}>
                  {activeOrders}
                </span>
              </div>
            </Link>

            {/* Completed orders */}
            <Link to="/dashboard/orders" className="card card-hover p-6 animate-slide-up" style={{ animationDelay: '0.15s' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-50 text-success-600">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('dashboard.completedOrders')}</h3>
                </div>
                <span className={`text-2xl font-bold ${completedOrders > 0 ? 'text-success-600' : 'text-slate-300 dark:text-slate-600'}`}>
                  {completedOrders}
                </span>
              </div>
            </Link>
          </div>
        )}

        {/* Payments / Wallet row */}
        {overviewStatus.state === 'loading' ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : overviewStatus.state === 'error' ? null : (
          <div className="grid gap-4 sm:grid-cols-3">
            <Link to="/dashboard/payments" className="card card-hover p-6 animate-slide-up">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-50 text-warning-600">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('dashboard.pendingPayments')}</h3>
                </div>
                <span className={`text-2xl font-bold ${pendingPayments > 0 ? 'text-warning-600' : 'text-slate-300 dark:text-slate-600'}`}>
                  {pendingPayments}
                </span>
              </div>
            </Link>

            <Link to="/dashboard/payments" className="card card-hover p-6 animate-slide-up" style={{ animationDelay: '0.05s' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-50 text-success-600">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('dashboard.completedPayments')}</h3>
                </div>
                <span className={`text-2xl font-bold ${completedPayments > 0 ? 'text-success-600' : 'text-slate-300 dark:text-slate-600'}`}>
                  {completedPayments}
                </span>
              </div>
            </Link>

            <Link to="/dashboard/wallet" className="card card-hover p-6 animate-slide-up" style={{ animationDelay: '0.1s' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
                    <Wallet className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('dashboard.walletBalance')}</h3>
                </div>
                <span className={`text-2xl font-bold ${walletBalance > 0 ? 'text-primary-600 dark:text-primary-400' : 'text-slate-300 dark:text-slate-600'}`}>
                  {walletBalance.toFixed(2)}
                </span>
              </div>
            </Link>
          </div>
        )}

        {/* My Shipments — sender only */}
        {!isTraveler && (
        <DashboardSection
          title={t('dashboard.myShipments')}
          viewAllTo="/dashboard/shipments"
          viewAllLabel={t('dashboard.viewAll')}
          loading={shipmentsStatus.state === 'loading'}
          error={shipmentsStatus.state === 'error'}
          errorKey={t('dashboard.failedShipments')}
          onRetry={fetchDashboardData}
          retryLabel={t('common.retry')}
          empty={shipmentsStatus.state === 'loaded' && recentShipments.length === 0}
          emptyIcon={<Package className="h-8 w-8" />}
          emptyTitle={t('dashboard.noShipments')}
          emptyDesc={t('dashboard.noShipmentsDesc')}
          emptyAction={
            <Link to="/dashboard/shipments/new" className="btn-primary btn-sm">
              {t('dashboard.createShipment')}
            </Link>
          }
        >
          <div className="space-y-2">
            {recentShipments.map((s) => (
              <Link
                key={s.id}
                to="/dashboard/shipments"
                className="flex items-center justify-between rounded-lg border border-slate-100 dark:border-slate-700 p-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Package className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{s.product_name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{s.origin} → {s.destination}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge text-xs ${listingStatusBadge(s.status)}`}>{listingStatusLabel(s.status, t)}</span>
                  <ArrowRight className={`h-4 w-4 text-slate-300 dark:text-slate-600 ${arrow}`} />
                </div>
              </Link>
            ))}
          </div>
        </DashboardSection>
        )}

        {/* Collaboration Requests */}
        <DashboardSection
          title={t('dashboard.collaborationRequests')}
          viewAllTo="/dashboard/collaborations"
          viewAllLabel={t('dashboard.viewAll')}
          loading={collabStatus.state === 'loading'}
          error={collabStatus.state === 'error'}
          errorKey={t('dashboard.failedCollaborations')}
          onRetry={fetchDashboardData}
          retryLabel={t('common.retry')}
          empty={collabStatus.state === 'loaded' && recentCollabs.length === 0}
          emptyIcon={<Handshake className="h-8 w-8" />}
          emptyTitle={t('dashboard.noCollaborations')}
          emptyDesc={t('dashboard.noCollaborationsDesc')}
          emptyAction={
            <Link to="/trips" className="btn-secondary btn-sm">
              {t('dashboard.browseTrips')}
            </Link>
          }
        >
          <div className="space-y-2">
            {recentCollabs.map((c) => (
              <Link
                key={c.id}
                to={`/dashboard/collaborations/${c.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-100 dark:border-slate-700 p-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Handshake className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                  <div>
                    {c.trips && <p className="text-sm font-medium text-slate-900 dark:text-white">{c.trips.origin} → {c.trips.destination}</p>}
                    {c.sender_listings && <p className="text-xs text-slate-500 dark:text-slate-400">{c.sender_listings.product_name}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge text-xs ${collabStatusBadge(c.status)}`}>{collabStatusLabel(c.status, t)}</span>
                  <ArrowRight className={`h-4 w-4 text-slate-300 dark:text-slate-600 ${arrow}`} />
                </div>
              </Link>
            ))}
          </div>
        </DashboardSection>

        {/* Active Orders */}
        <DashboardSection
          title={t('dashboard.activeOrders')}
          viewAllTo="/dashboard/orders"
          viewAllLabel={t('dashboard.viewAll')}
          loading={ordersStatus.state === 'loading'}
          error={ordersStatus.state === 'error'}
          errorKey={t('dashboard.failedOrders')}
          onRetry={fetchDashboardData}
          retryLabel={t('common.retry')}
          empty={ordersStatus.state === 'loaded' && recentOrders.length === 0}
          emptyIcon={<ClipboardList className="h-8 w-8" />}
          emptyTitle={t('dashboard.noActiveOrders')}
          emptyDesc={t('dashboard.noActiveOrdersDesc')}
          emptyAction={
            isTraveler
              ? <Link to="/dashboard/trips" className="btn-primary btn-sm">{t('dashboard.viewTrips')}</Link>
              : <Link to="/dashboard/shipments/new" className="btn-primary btn-sm">{t('dashboard.createShipment')}</Link>
          }
        >
          <div className="space-y-2">
            {recentOrders.map((o) => (
              <Link
                key={o.id}
                to={`/dashboard/orders/${o.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-100 dark:border-slate-700 p-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Truck className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{o.order_number}</p>
                    {o.trips && <p className="text-xs text-slate-500 dark:text-slate-400">{o.trips.origin} → {o.trips.destination}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge text-xs ${orderStatusBadge(o.status)}`}>{orderStatusLabel(o.status, t)}</span>
                  <ArrowRight className={`h-4 w-4 text-slate-300 dark:text-slate-600 ${arrow}`} />
                </div>
              </Link>
            ))}
          </div>
        </DashboardSection>

        {/* Recent conversations */}
        <DashboardSection
          title={t('dashboard.recentConversations')}
          viewAllTo="/dashboard/messages"
          viewAllLabel={t('dashboard.viewAll')}
          loading={convStatus.state === 'loading'}
          error={convStatus.state === 'error'}
          errorKey={t('dashboard.failedMessages')}
          onRetry={fetchDashboardData}
          retryLabel={t('common.retry')}
          empty={convStatus.state === 'loaded' && recentConversations.length === 0}
          emptyIcon={<MessageSquare className="h-8 w-8" />}
          emptyTitle={t('empty.noMessages')}
        >
          <div className="space-y-2">
            {recentConversations.map((conv) => {
              const trip = conv.collaborations?.trips;
              return (
                <Link
                  key={conv.id}
                  to={`/dashboard/messages/${conv.id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-100 dark:border-slate-700 p-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <MessageSquare className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                    <div>
                      {trip && <p className="text-sm font-medium text-slate-900 dark:text-white">{trip.origin} → {trip.destination}</p>}
                      <p className="text-xs text-slate-500 dark:text-slate-400">{conv.last_message_at ? new Date(conv.last_message_at).toLocaleDateString() : '—'}</p>
                    </div>
                  </div>
                  <ArrowRight className={`h-4 w-4 text-slate-300 dark:text-slate-600 ${arrow}`} />
                </Link>
              );
            })}
          </div>
        </DashboardSection>

        {/* Recent notifications */}
        <DashboardSection
          title={t('dashboard.recentNotifications')}
          viewAllTo="/dashboard/notifications"
          viewAllLabel={t('dashboard.viewAll')}
          loading={notifStatus.state === 'loading'}
          error={notifStatus.state === 'error'}
          errorKey={t('dashboard.failedNotifications')}
          onRetry={fetchDashboardData}
          retryLabel={t('common.retry')}
          empty={notifStatus.state === 'loaded' && recentNotifications.length === 0}
          emptyIcon={<Bell className="h-8 w-8" />}
          emptyTitle={t('empty.noNotifications')}
        >
          <div className="space-y-2">
            {recentNotifications.map((notif) => (
              <Link
                key={notif.id}
                to="/dashboard/notifications"
                className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${notif.is_read ? 'border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800' : 'border-primary-200 bg-primary-50 dark:bg-primary-900/30 hover:bg-primary-50 dark:hover:bg-primary-900/40'}`}
              >
                <div className="flex items-center gap-3">
                  <Bell className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{notif.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{new Date(notif.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                {!notif.is_read && <span className="badge-primary text-xs">{t('notifications.unread')}</span>}
              </Link>
            ))}
          </div>
        </DashboardSection>
      </div>
    </UserLayout>
  );
}

// ── Verification card ────────────────────────────────────────
function VerificationCard({ status, t, dir }: { status: VerificationStatus; t: (k: TranslationKey) => string; dir: string }) {
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const config = {
    unverified: {
      icon: <ShieldAlert className="h-6 w-6" />,
      bg: 'border-warning-200 bg-warning-50',
      iconBg: 'bg-warning-100 text-warning-600',
      title: t('verification.unverifiedTitle'),
      desc: t('verification.unverifiedDesc'),
      cta: t('verification.submitTitle'),
    },
    pending: {
      icon: <Clock className="h-6 w-6" />,
      bg: 'border-accent-200 bg-accent-50 dark:bg-accent-900/30',
      iconBg: 'bg-accent-100 text-accent-600 dark:text-accent-400',
      title: t('verification.pendingTitle'),
      desc: t('verification.pendingDesc'),
      cta: null,
    },
    approved: {
      icon: <CheckCircle2 className="h-6 w-6" />,
      bg: 'border-success-200 bg-success-50',
      iconBg: 'bg-success-100 text-success-600',
      title: t('verification.approvedTitle'),
      desc: t('verification.approvedDesc'),
      cta: null,
    },
    rejected: {
      icon: <XCircle className="h-6 w-6" />,
      bg: 'border-error-200 bg-error-50 dark:bg-error-900/40',
      iconBg: 'bg-error-100 text-error-600',
      title: t('verification.rejectedTitle'),
      desc: t('verification.rejectedDesc'),
      cta: t('verification.resubmit'),
    },
  }[status];

  return (
    <Link to="/dashboard/verification" className={`card block border-2 p-6 ${config.bg} card-hover animate-slide-up`}>
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${config.iconBg}`}>
          {config.icon}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-900 dark:text-white">{config.title}</h3>
            <ShieldCheck className="h-4 w-4 text-slate-400 dark:text-slate-500" />
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{config.desc}</p>
          {config.cta && (
            <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 dark:text-primary-400">
              {config.cta}
              <ArrowRight className={`h-4 w-4 ${arrow}`} />
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ── Helpers ──────────────────────────────────────────────────
function InfoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      {children}
    </div>
  );
}

function roleLabel(role: UserRole, t: (k: TranslationKey) => string): string {
  switch (role) {
    case 'traveler': return t('status.traveler');
    case 'sender': return t('status.sender');
    case 'admin': return t('status.admin');
    case 'marketing': return t('status.marketing');
    case 'support': return t('support.title');
  }
}

function statusLabel(s: AccountStatus, t: (k: TranslationKey) => string): string {
  switch (s) {
    case 'pending': return t('status.pending');
    case 'active': return t('status.active');
    case 'suspended': return t('status.suspended');
  }
}

function roleBadgeClass(role: UserRole): string {
  switch (role) {
    case 'traveler': return 'badge-primary';
    case 'sender': return 'badge-accent';
    case 'admin': return 'badge-warning';
    case 'marketing': return 'badge-accent';
    case 'support': return 'badge-primary';
  }
}

function statusBadgeClass(s: AccountStatus): string {
  switch (s) {
    case 'pending': return 'badge-warning';
    case 'active': return 'badge-success';
    case 'suspended': return 'badge-error';
  }
}

function listingStatusLabel(status: ListingStatus, t: (k: TranslationKey) => string): string {
  switch (status) {
    case 'draft': return t('status.pending');
    case 'published': return t('status.active');
    case 'matched': return t('dashboard.viewOrders');
    case 'completed': return t('dashboard.completedOrders');
    case 'cancelled': return t('order.status.cancelled');
    default: return status;
  }
}

function listingStatusBadge(status: ListingStatus): string {
  switch (status) {
    case 'draft': return 'badge-warning';
    case 'published': return 'badge-success';
    case 'matched': return 'badge-primary';
    case 'completed': return 'badge-primary';
    case 'cancelled': return 'badge-error';
    default: return 'badge-neutral';
  }
}

function collabStatusLabel(status: CollaborationStatus, t: (k: TranslationKey) => string): string {
  switch (status) {
    case 'pending': return t('status.pending');
    case 'accepted': return t('verification.approvedTitle');
    case 'rejected': return t('verification.rejectedTitle');
    case 'cancelled': return t('order.status.cancelled');
    case 'completed': return t('dashboard.completedOrders');
    default: return status;
  }
}

function collabStatusBadge(status: CollaborationStatus): string {
  switch (status) {
    case 'pending': return 'badge-warning';
    case 'accepted': return 'badge-success';
    case 'rejected': return 'badge-error';
    case 'cancelled': return 'badge-neutral';
    case 'completed': return 'badge-primary';
    default: return 'badge-neutral';
  }
}

function orderStatusLabel(status: OrderStatus, t: (k: TranslationKey) => string): string {
  const key = `order.status.${status}` as TranslationKey;
  return t(key);
}

function orderStatusBadge(status: OrderStatus): string {
  switch (status) {
    case 'pending': return 'badge-warning';
    case 'awaiting_payment': return 'badge-warning';
    case 'confirmed': return 'badge-primary';
    case 'in_transit': return 'badge-accent';
    case 'delivered': return 'badge-accent';
    case 'received': return 'badge-primary';
    case 'completed': return 'badge-success';
    case 'cancelled': return 'badge-error';
    default: return 'badge-neutral';
  }
}
