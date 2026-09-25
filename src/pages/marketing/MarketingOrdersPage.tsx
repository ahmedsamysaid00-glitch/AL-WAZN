import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { MarketingLayout } from './MarketingLayout';
import { PackageCheck, MapPin, ArrowRight, Weight, Calendar, Check } from 'lucide-react';

interface CompletedOrder {
  id: string;
  order_number: string;
  status: string;
  pickup_location: string | null;
  delivery_location: string | null;
  agreed_weight_kg: number;
  created_at: string;
  completed_at: string | null;
  product_name: string | null;
  origin: string | null;
  destination: string | null;
}

export function MarketingOrdersPage() {
  const { t, dir } = useLanguage();
  const [orders, setOrders] = useState<CompletedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const arrow = dir === 'rtl' ? 'rotate-180' : '';

  const fetchOrders = useCallback(async () => {
    setError(false);
    try {
      const { data, error: err } = await supabase.rpc('get_marketing_completed_orders');
      if (err) { setError(true); setOrders([]); return; }
      setOrders((data as CompletedOrder[]) ?? []);
    } catch {
      setError(true);
    }
  }, []);

  const fetchOrdersInitial = useCallback(async () => {
    setLoading(true);
    await fetchOrders();
    setLoading(false);
  }, [fetchOrders]);

  useEffect(() => {
    fetchOrdersInitial();
  }, [fetchOrdersInitial]);

  useRealtimeRefresh(
    [{ table: 'orders' }],
    () => fetchOrders(),
    true,
  );

  if (loading) {
    return (
      <MarketingLayout>
        <div className="max-w-4xl">
          <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('marketing.completedOrdersTitle')}</h1>
          <div className="card"><LoadingState label={t('marketing.loadingOrders')} /></div>
        </div>
      </MarketingLayout>
    );
  }

  if (error) {
    return (
      <MarketingLayout>
        <div className="max-w-4xl">
          <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('marketing.completedOrdersTitle')}</h1>
          <div className="card">
            <ErrorState message={t('marketing.failedLoadOrders')} onRetry={fetchOrders} retryLabel={t('common.retry')} />
          </div>
        </div>
      </MarketingLayout>
    );
  }

  return (
    <MarketingLayout>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('marketing.completedOrdersTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('marketing.completedOrdersSubtitle')}</p>
        </div>

        {orders.length === 0 ? (
          <div className="card"><EmptyState icon={<PackageCheck className="h-8 w-8" />} title={t('marketing.noCompletedOrders')} /></div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <div key={order.id} className="card p-5 animate-fade-in">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="badge-success">{t('order.status.completed')}</span>
                      <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{order.order_number}</span>
                    </div>
                    {order.origin && order.destination && (
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                        <MapPin className="h-4 w-4 shrink-0 text-primary-500" />
                        <span className="break-anywhere">{order.origin}</span> <ArrowRight className={`h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500 ${arrow}`} /> <span className="break-anywhere">{order.destination}</span>
                      </div>
                    )}
                    {order.product_name && (
                      <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                        <PackageCheck className="h-4 w-4 shrink-0 text-accent-500" />
                        <span className="break-anywhere">{order.product_name}</span>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
                      {order.agreed_weight_kg > 0 && (
                        <span className="flex items-center gap-1"><Weight className="h-3.5 w-3.5" />{order.agreed_weight_kg} {t('discover.kg')}</span>
                      )}
                      {order.created_at && (
                        <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{t('marketing.createdOn')}: {new Date(order.created_at).toLocaleDateString()}</span>
                      )}
                      {order.completed_at && (
                        <span className="flex items-center gap-1"><Check className="h-3.5 w-3.5 text-success-500" />{t('marketing.completedOn')}: {new Date(order.completed_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </MarketingLayout>
  );
}
