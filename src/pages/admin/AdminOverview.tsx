import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { useLanguage } from '@/i18n/useLanguage';
import { AdminLayout } from './AdminLayout';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { Users, Plane, Package, Shield, ShieldCheck, CreditCard, TrendingUp, AlertCircle, CheckCircle2, XCircle, RotateCcw, type LucideIcon } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';

interface Stats {
  total: number;
  travelers: number;
  senders: number;
  admins: number;
  pendingVerifications: number;
  totalTrips: number;
  publishedTrips: number;
  totalListings: number;
  publishedListings: number;
  paymentVolume: number;
  platformFees: number;
  pendingPayments: number;
  successfulPayments: number;
  failedPayments: number;
  refundedAmount: number;
}

export function AdminOverview() {
  const { t } = useLanguage();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(false);

    const { data, error: err } = await supabase
      .from('profiles')
      .select('role');

    if (err) {
      setError(true);
      setLoading(false);
      return;
    }

    const { count: pendingVerifications, error: vrErr } = await supabase
      .from('verification_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: totalTrips } = await supabase.from('trips').select('*', { count: 'exact', head: true });
    const { count: publishedTrips } = await supabase.from('trips').select('*', { count: 'exact', head: true }).eq('status', 'published');
    const { count: totalListings } = await supabase.from('sender_listings').select('*', { count: 'exact', head: true });
    const { count: publishedListings } = await supabase.from('sender_listings').select('*', { count: 'exact', head: true }).eq('status', 'published');

    // Payment stats via RPC
    let payStats = { volume: 0, fees: 0, pending: 0, successful: 0, failed: 0, refunded: 0 };
    const { data: payData } = await supabase.rpc('get_payment_stats');
    if (payData) payStats = payData as typeof payStats;

    const counts: Stats = {
      total: data.length,
      travelers: data.filter((p) => p.role === 'traveler').length,
      senders: data.filter((p) => p.role === 'sender').length,
      admins: data.filter((p) => p.role === 'admin').length,
      pendingVerifications: vrErr ? 0 : (pendingVerifications ?? 0),
      totalTrips: totalTrips ?? 0,
      publishedTrips: publishedTrips ?? 0,
      totalListings: totalListings ?? 0,
      publishedListings: publishedListings ?? 0,
      paymentVolume: payStats.volume,
      platformFees: payStats.fees,
      pendingPayments: payStats.pending,
      successfulPayments: payStats.successful,
      failedPayments: payStats.failed,
      refundedAmount: payStats.refunded,
    };

    setStats(counts);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useRealtimeRefresh(
    [
      { table: 'profiles' },
      { table: 'orders' },
      { table: 'payments' },
      { table: 'refunds' },
      { table: 'trips' },
      { table: 'sender_listings' },
      { table: 'verification_requests' },
      { table: 'user_requests' },
      { table: 'collaborations' },
    ],
    () => fetchStats(),
  );

  const cards: { labelKey: TranslationKey; value: number; icon: LucideIcon; iconClass: string }[] = [
    { labelKey: 'admin.totalUsers', value: stats?.total ?? 0, icon: Users, iconClass: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
    { labelKey: 'admin.travelers', value: stats?.travelers ?? 0, icon: Plane, iconClass: 'bg-accent-50 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400' },
    { labelKey: 'admin.senders', value: stats?.senders ?? 0, icon: Package, iconClass: 'bg-secondary-50 text-secondary-600 dark:text-secondary-400' },
    { labelKey: 'admin.admins', value: stats?.admins ?? 0, icon: Shield, iconClass: 'bg-error-50 text-error-600' },
    { labelKey: 'admin.verificationPendingCount', value: stats?.pendingVerifications ?? 0, icon: ShieldCheck, iconClass: 'bg-warning-50 text-warning-600' },
    { labelKey: 'admin.totalTrips', value: stats?.totalTrips ?? 0, icon: Plane, iconClass: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
    { labelKey: 'admin.totalListings', value: stats?.totalListings ?? 0, icon: Package, iconClass: 'bg-secondary-50 text-secondary-600 dark:text-secondary-400' },
    { labelKey: 'admin.totalPaymentVolume', value: stats?.paymentVolume ?? 0, icon: CreditCard, iconClass: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
    { labelKey: 'admin.totalPlatformFees', value: stats?.platformFees ?? 0, icon: TrendingUp, iconClass: 'bg-success-50 text-success-600' },
    { labelKey: 'admin.pendingPayments', value: stats?.pendingPayments ?? 0, icon: AlertCircle, iconClass: 'bg-warning-50 text-warning-600' },
    { labelKey: 'admin.successfulPayments', value: stats?.successfulPayments ?? 0, icon: CheckCircle2, iconClass: 'bg-success-50 text-success-600' },
    { labelKey: 'admin.failedPayments', value: stats?.failedPayments ?? 0, icon: XCircle, iconClass: 'bg-error-50 text-error-600' },
    { labelKey: 'admin.refundedAmount', value: stats?.refundedAmount ?? 0, icon: RotateCcw, iconClass: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('admin.overview')}</h1>
        </div>

        {loading ? (
          <div className="card">
            <LoadingState label={t('admin.loadingStats')} />
          </div>
        ) : error ? (
          <div className="card">
            <ErrorState
              message={t('admin.failedStats')}
              onRetry={fetchStats}
              retryLabel={t('common.retry')}
            />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((card, i) => {
              const Icon = card.icon;
              return (
                <div
                  key={i}
                  className="card p-6 animate-slide-up"
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t(card.labelKey)}</p>
                      <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-white">{card.value}</p>
                    </div>
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${card.iconClass}`}>
                      <Icon className="h-6 w-6" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
