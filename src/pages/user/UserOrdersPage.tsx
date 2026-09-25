import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { UserLayout } from './UserLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Pagination } from '@/components/ui/Pagination';
import { Package, MapPin, ArrowRight, Weight, DollarSign } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { OrderWithDetails, OrderStatus } from '@/types/database';

type TabKey = 'active' | 'completed' | 'cancelled';
const PAGE_SIZE = 10;

const TAB_STATUSES: Record<TabKey, OrderStatus[]> = {
  active: ['pending', 'awaiting_payment', 'confirmed', 'in_transit', 'delivered', 'received'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

export function UserOrdersPage() {
  const { t, dir } = useLanguage();
  const { profile } = useAuth();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<TabKey>('active');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [tabCounts, setTabCounts] = useState<Record<TabKey, number>>({ active: 0, completed: 0, cancelled: 0 });
  const fetchingRef = useRef(false);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const fetchOrders = useCallback(async (pageNum: number, currentTab: TabKey) => {
    if (!profile?.id || fetchingRef.current) return;
    fetchingRef.current = true;
    setError(false);

    const statuses = TAB_STATUSES[currentTab];
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error: err, count } = await supabase
      .from('orders')
      .select(`
        *,
        trips(origin, destination, departure_date, arrival_date, profiles(full_name)),
        sender_listings(product_name, weight_kg, origin, destination, profiles(full_name))
      `, { count: 'exact' })
      .or(`traveler_id.eq.${profile.id},sender_id.eq.${profile.id}`)
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (err) { setError(true); setOrders([]); fetchingRef.current = false; return; }
    setOrders((data as OrderWithDetails[]) ?? []);
    setTotalCount(count ?? 0);

    // Fetch tab counts in parallel (head-only queries)
    const uid = profile.id;
    const [activeRes, completedRes, cancelledRes] = await Promise.all([
      supabase.from('orders').select('id', { count: 'exact', head: true })
        .or(`traveler_id.eq.${uid},sender_id.eq.${uid}`).in('status', TAB_STATUSES.active),
      supabase.from('orders').select('id', { count: 'exact', head: true })
        .or(`traveler_id.eq.${uid},sender_id.eq.${uid}`).eq('status', 'completed'),
      supabase.from('orders').select('id', { count: 'exact', head: true })
        .or(`traveler_id.eq.${uid},sender_id.eq.${uid}`).eq('status', 'cancelled'),
    ]);
    setTabCounts({
      active: activeRes.count ?? 0,
      completed: completedRes.count ?? 0,
      cancelled: cancelledRes.count ?? 0,
    });

    fetchingRef.current = false;
  }, [profile?.id]);

  const fetchOrdersInitial = useCallback(async () => {
    setLoading(true);
    await fetchOrders(0, 'active');
    setLoading(false);
  }, [fetchOrders]);

  useEffect(() => { fetchOrdersInitial(); }, [fetchOrdersInitial]);

  useRealtimeRefresh(
    [{ table: 'orders' }, { table: 'shipment_tracking_events' }],
    () => fetchOrders(page, tab),
    !!profile?.id,
  );

  const handleTabChange = (newTab: TabKey) => {
    setTab(newTab);
    setPage(0);
    fetchOrders(0, newTab);
  };

  const goToPage = (newPage: number) => {
    setPage(newPage);
    fetchOrders(newPage, tab);
  };

  const tabs: { key: TabKey; labelKey: TranslationKey; count: number }[] = [
    { key: 'active', labelKey: 'orders.tabActive', count: tabCounts.active },
    { key: 'completed', labelKey: 'orders.tabCompleted', count: tabCounts.completed },
    { key: 'cancelled', labelKey: 'orders.tabCancelled', count: tabCounts.cancelled },
  ];

  if (loading) return (
    <UserLayout>
      <div className="max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('orders.title')}</h1>
        <div className="card"><LoadingState label={t('orders.loading')} /></div>
      </div>
    </UserLayout>
  );

  if (error) return (
    <UserLayout>
      <div className="max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('orders.title')}</h1>
        <div className="card"><ErrorState message={t('orders.failed')} onRetry={() => goToPage(page)} retryLabel={t('common.retry')} /></div>
      </div>
    </UserLayout>
  );

  return (
    <UserLayout>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('orders.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('orders.subtitle')}</p>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              onClick={() => handleTabChange(tb.key)}
              className={`relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === tb.key
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t(tb.labelKey)}
              {tb.count > 0 && (
                <span className="ml-2 inline-flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  {tb.count}
                </span>
              )}
              {tab === tb.key && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary-600" />}
            </button>
          ))}
        </div>

        {orders.length === 0 ? (
          <div className="card"><EmptyState icon={<Package className="h-8 w-8" />} title={t('orders.empty')} /></div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} t={t} arrow={arrow} />
            ))}
          </div>
        )}

        <Pagination page={page} totalPages={totalPages} onPageChange={goToPage} t={t} rtl={dir === 'rtl'} />
      </div>
    </UserLayout>
  );
}

function OrderCard({ order, t, arrow }: { order: OrderWithDetails; t: (k: TranslationKey) => string; arrow: string }) {
  const trip = order.trips;
  const listing = order.sender_listings;

  return (
    <Link
      to={`/dashboard/orders/${order.id}`}
      className="card card-hover p-5 animate-fade-in block"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <StatusBadge status={order.status} t={t} />
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{order.order_number}</span>
          </div>
          {trip && (
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
              <MapPin className="h-4 w-4 shrink-0 text-primary-500" />
              <span className="break-anywhere">{trip.origin}</span> <ArrowRight className={`h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500 ${arrow}`} /> <span className="break-anywhere">{trip.destination}</span>
            </div>
          )}
          {listing && (
            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <Package className="h-4 w-4 shrink-0 text-accent-500" />
              <span className="break-anywhere">{listing.product_name}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1"><Weight className="h-3.5 w-3.5" />{order.agreed_weight_kg} kg</span>
            <span className="flex items-center gap-1"><DollarSign className="h-3.5 w-3.5" />{order.agreed_price}</span>
            {order.expected_delivery_date && <span>{t('orders.expectedDelivery')}: {order.expected_delivery_date}</span>}
          </div>
        </div>
        <ArrowRight className={`h-5 w-5 text-slate-300 dark:text-slate-600 shrink-0 ${arrow}`} />
      </div>
    </Link>
  );
}

function StatusBadge({ status, t }: { status: OrderStatus; t: (k: TranslationKey) => string }) {
  const map: Record<OrderStatus, string> = {
    pending: 'badge-warning',
    awaiting_payment: 'badge-warning',
    confirmed: 'badge-primary',
    in_transit: 'badge-accent',
    delivered: 'badge-accent',
    received: 'badge-success',
    completed: 'badge-success',
    cancelled: 'badge-error',
  };
  const labelKey: Record<OrderStatus, TranslationKey> = {
    pending: 'order.status.pending',
    awaiting_payment: 'order.status.awaiting_payment',
    confirmed: 'order.status.confirmed',
    in_transit: 'order.status.in_transit',
    delivered: 'order.status.delivered',
    received: 'order.status.received',
    completed: 'order.status.completed',
    cancelled: 'order.status.cancelled',
  };
  return <span className={map[status]}>{t(labelKey[status])}</span>;
}
