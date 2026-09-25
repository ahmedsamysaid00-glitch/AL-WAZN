import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { useLanguage } from '@/i18n/useLanguage';
import { AdminLayout } from './AdminLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Package, Search, MapPin, ArrowRight, ChevronLeft, ChevronRight, Weight, DollarSign, ArrowUp, ArrowDown } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { OrderWithDetails, ShipmentTrackingEvent, OrderStatus } from '@/types/database';

const PAGE_SIZE = 10;

export function AdminOrders() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ col: string; asc: boolean }>({ col: 'created_at', asc: false });
  const [selectedOrder, setSelectedOrder] = useState<OrderWithDetails | null>(null);
  const [trackingEvents, setTrackingEvents] = useState<ShipmentTrackingEvent[]>([]);
  const [loadingTracking, setLoadingTracking] = useState(false);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(false);
    let query = supabase
      .from('orders')
      .select(`
        *,
        trips!inner(origin, destination, departure_date, arrival_date, profiles(full_name)),
        sender_listings!inner(product_name, weight_kg, origin, destination, profiles(full_name))
      `, { count: 'exact' });
    if (search.trim()) {
      const s = search.trim();
      query = query.or(`order_number.ilike.%${s}%,pickup_location.ilike.%${s}%,delivery_location.ilike.%${s}%,trips.origin.ilike.%${s}%,trips.destination.ilike.%${s}%,sender_listings.product_name.ilike.%${s}%,sender_listings.origin.ilike.%${s}%,sender_listings.destination.ilike.%${s}%`);
    }
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    query = query.order(sort.col, { ascending: sort.asc });
    if (sort.col !== 'created_at') query = query.order('created_at', { ascending: false });
    query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, error: err } = await query;
    if (err) { setError(true); setLoading(false); return; }
    setOrders((data as OrderWithDetails[]) ?? []);
    setLoading(false);
  }, [search, statusFilter, page, sort]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  useRealtimeRefresh(
    [{ table: 'orders' }, { table: 'shipment_tracking_events' }, { table: 'delivery_qr_tokens' }],
    () => fetchOrders(),
  );

  const viewOrderDetail = async (order: OrderWithDetails) => {
    setSelectedOrder(order);
    setLoadingTracking(true);
    const { data: events } = await supabase
      .from('shipment_tracking_events')
      .select('*')
      .eq('order_id', order.id)
      .order('created_at', { ascending: true });
    setTrackingEvents((events as ShipmentTrackingEvent[]) ?? []);
    setLoadingTracking(false);
  };

  const hasFilters = search.trim() || statusFilter !== 'all';

  const toggleSort = (col: string) => {
    setSort((prev) => prev.col === col ? { col, asc: !prev.asc } : { col, asc: true });
    setPage(0);
  };
  const sortIcon = (col: string) => sort.col === col ? (sort.asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('admin.ordersTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('admin.ordersSubtitle')}</p>
        </div>

        {/* Filters */}
        <div className="card p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500 ltr:left-3.5 rtl:right-3.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                placeholder={t('admin.searchUsers')}
                className="input ltr:pl-10 rtl:pr-10"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as OrderStatus | 'all'); setPage(0); }}
              className="input min-w-[160px]"
            >
              <option value="all">{t('admin.allOrderStatuses')}</option>
              <option value="pending">{t('order.status.pending')}</option>
              <option value="awaiting_payment">{t('order.status.awaiting_payment')}</option>
              <option value="confirmed">{t('order.status.confirmed')}</option>
              <option value="in_transit">{t('order.status.in_transit')}</option>
              <option value="delivered">{t('order.status.delivered')}</option>
              <option value="received">{t('order.status.received')}</option>
              <option value="completed">{t('order.status.completed')}</option>
              <option value="cancelled">{t('order.status.cancelled')}</option>
            </select>
          </div>
        </div>

        {/* Order detail modal */}
        {selectedOrder && (
          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {selectedOrder.order_number}
              </h2>
              <button onClick={() => setSelectedOrder(null)} className="btn-ghost btn-sm">{t('common.close')}</button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">{t('admin.orderTrip')}</h3>
                {selectedOrder.trips && (
                  <>
                    <p className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-primary-500" />
                      {selectedOrder.trips.origin} <ArrowRight className={`h-3 w-3 text-slate-400 dark:text-slate-500 ${arrow}`} /> {selectedOrder.trips.destination}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{selectedOrder.trips.departure_date} → {selectedOrder.trips.arrival_date}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('orders.traveler')}: {selectedOrder.trips.profiles?.full_name ?? t('admin.deletedUser')}</p>
                  </>
                )}
              </div>
              <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">{t('admin.orderListing')}</h3>
                {selectedOrder.sender_listings && (
                  <>
                    <p className="text-sm text-slate-600 dark:text-slate-400">{selectedOrder.sender_listings.product_name}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{selectedOrder.sender_listings.weight_kg} kg</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('orders.sender')}: {selectedOrder.sender_listings.profiles?.full_name ?? t('admin.deletedUser')}</p>
                  </>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('orders.weight')}</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{selectedOrder.agreed_weight_kg} kg</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('orders.price')}</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{selectedOrder.agreed_price}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('orders.platformFee')}</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{selectedOrder.platform_fee}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('orders.totalAmount')}</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{selectedOrder.total_amount} {selectedOrder.currency}</p>
              </div>
            </div>

            {/* Tracking */}
            <div>
              <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">{t('admin.orderTracking')}</h3>
              {loadingTracking ? (
                <LoadingState />
              ) : trackingEvents.length === 0 ? (
                <EmptyState icon={<Package className="h-8 w-8" />} title={t('orders.noTrackingEvents')} />
              ) : (
                <div className="space-y-0 rounded-lg border border-slate-100 dark:border-slate-700 p-4">
                  {trackingEvents.map((event, idx) => {
                    const isLast = idx === trackingEvents.length - 1;
                    return (
                      <div key={event.id} className="flex gap-3">
                        <div className={`h-2 w-2 rounded-full mt-1.5 ${isLast ? 'bg-primary-600' : 'bg-slate-300'}`} />
                        <div className="flex-1 pb-3">
                          <p className={`text-sm font-medium ${isLast ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'}`}>{event.title}</p>
                          {event.description && <p className="text-xs text-slate-500 dark:text-slate-400">{event.description}</p>}
                          <p className="text-xs text-slate-400 dark:text-slate-500">{new Date(event.created_at).toLocaleString()}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Orders table */}
        <div className="card overflow-hidden">
          {loading ? (
            <SkeletonTable rows={5} columns={9} />
          ) : error ? (
            <ErrorState message={t('admin.failedOrders')} onRetry={fetchOrders} retryLabel={t('common.retry')} />
          ) : orders.length === 0 ? (
            <EmptyState icon={<Package className="h-8 w-8" />} title={hasFilters ? t('admin.noOrderResults') : t('orders.empty')} />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-left">
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.orderNumber')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('orders.traveler')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('orders.sender')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('orders.product')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.orderRoute')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.orderWeight')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
                        <button onClick={() => toggleSort('agreed_price')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">{t('admin.orderPrice')}{sortIcon('agreed_price')}</button>
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
                        <button onClick={() => toggleSort('status')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">{t('admin.orderStatus')}{sortIcon('status')}</button>
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
                        <button onClick={() => toggleSort('created_at')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">{t('admin.orderCreated')}{sortIcon('created_at')}</button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map((o) => (
                      <tr
                        key={o.id}
                        onClick={() => viewOrderDetail(o)}
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{o.order_number}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{o.trips?.profiles?.full_name ?? t('admin.deletedUser')}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{o.sender_listings?.profiles?.full_name ?? t('admin.deletedUser')}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{o.sender_listings?.product_name ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {o.trips && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5 shrink-0 text-primary-500" />
                              <span className="break-anywhere">{o.trips.origin}</span> <ArrowRight className={`h-3 w-3 shrink-0 text-slate-400 dark:text-slate-500 ${arrow}`} /> <span className="break-anywhere">{o.trips.destination}</span>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{o.agreed_weight_kg} kg</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{o.agreed_price}</td>
                        <td className="px-4 py-3"><StatusBadge status={o.status} t={t} /></td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{new Date(o.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="divide-y divide-slate-100 md:hidden">
                {orders.map((o) => (
                  <div key={o.id} onClick={() => viewOrderDetail(o)} className="cursor-pointer p-4 hover:bg-slate-50 dark:hover:bg-slate-800">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{o.order_number}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{o.sender_listings?.product_name ?? '—'}</p>
                      </div>
                      <StatusBadge status={o.status} t={t} />
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span className="flex items-center gap-1"><Weight className="h-3 w-3" />{o.agreed_weight_kg} kg</span>
                      <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />{o.agreed_price}</span>
                    </div>
                    {o.trips && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{o.trips.origin} → {o.trips.destination}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 px-4 py-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.page')} {page + 1}</p>
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary btn-sm">
                    <ChevronLeft className="h-4 w-4" />{t('common.previous')}
                  </button>
                  <button onClick={() => setPage((p) => p + 1)} disabled={orders.length < PAGE_SIZE} className="btn-secondary btn-sm">
                    {t('common.next')}<ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
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
