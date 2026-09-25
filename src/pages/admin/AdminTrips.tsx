import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { AdminLayout } from './AdminLayout';
import { ErrorState, EmptyState } from '@/components/ui/States';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Plane, Search, XCircle, AlertTriangle, X } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { TripWithTraveler, TripStatus } from '@/types/database';

type Toast = { type: 'success' | 'error'; message: string } | null;

const PAGE_SIZE = 10;

export function AdminTrips() {
  const { t } = useLanguage();
  const [trips, setTrips] = useState<TripWithTraveler[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TripStatus | 'all'>('all');
  const [originFilter, setOriginFilter] = useState('');
  const [destinationFilter, setDestinationFilter] = useState('');
  const [page, setPage] = useState(0);
  const [cancelTarget, setCancelTarget] = useState<TripWithTraveler | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const fetchTrips = useCallback(async () => {
    setLoading(true);
    setError(false);
    let query = supabase.from('trips').select('*, profiles!inner(full_name)', { count: 'exact' });
    if (search.trim()) query = query.or(`origin.ilike.%${search.trim()}%,destination.ilike.%${search.trim()}%`);
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (originFilter.trim()) query = query.ilike('origin', `%${originFilter.trim()}%`);
    if (destinationFilter.trim()) query = query.ilike('destination', `%${destinationFilter.trim()}%`);
    query = query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, error: err } = await query;
    if (err) { setError(true); setLoading(false); return; }
    setTrips((data as TripWithTraveler[]) ?? []);
    setLoading(false);
  }, [search, statusFilter, originFilter, destinationFilter, page]);

  useEffect(() => { fetchTrips(); }, [fetchTrips]);

  useRealtimeRefresh(
    [{ table: 'trips' }],
    () => fetchTrips(),
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleCancelClick = (trip: TripWithTraveler) => {
    setCancelTarget(trip);
    setCancelError(null);
  };

  const handleCancelConfirm = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    setCancelError(null);
    const { error: updateErr } = await supabase
      .from('trips')
      .update({ status: 'cancelled' })
      .eq('id', cancelTarget.id);
    if (updateErr) {
      setCancelError(t('admin.cancelTripFailed'));
      setCancelling(false);
      return;
    }
    setToast({ type: 'success', message: t('admin.cancelTripSuccess') });
    setCancelTarget(null);
    setCancelling(false);
    fetchTrips();
  };

  const handleCancelClose = () => {
    setCancelTarget(null);
    setCancelError(null);
  };

  const hasFilters = search.trim() || statusFilter !== 'all' || originFilter.trim() || destinationFilter.trim();

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('admin.tripsTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('admin.tripsSubtitle')}</p>
        </div>

        <div className="card p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500 ltr:left-3.5 rtl:right-3.5" />
              <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t('admin.searchUsers')} className="input ltr:pl-10 rtl:pr-10" />
            </div>
            <div className="flex flex-wrap gap-3">
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as TripStatus | 'all'); setPage(0); }} className="input min-w-[140px]">
                <option value="all">{t('admin.allStatuses')}</option>
                <option value="draft">{t('marketplace.status.draft')}</option>
                <option value="published">{t('marketplace.status.published')}</option>
                <option value="in_progress">{t('marketplace.status.in_progress')}</option>
                <option value="completed">{t('marketplace.status.completed')}</option>
                <option value="cancelled">{t('marketplace.status.cancelled')}</option>
              </select>
              <input type="text" placeholder={t('discover.filterOrigin')} value={originFilter} onChange={(e) => { setOriginFilter(e.target.value); setPage(0); }} className="input min-w-[120px]" />
              <input type="text" placeholder={t('discover.filterDestination')} value={destinationFilter} onChange={(e) => { setDestinationFilter(e.target.value); setPage(0); }} className="input min-w-[120px]" />
            </div>
          </div>
        </div>

        <div className="card overflow-hidden">
          {loading ? (
            <SkeletonTable rows={5} columns={7} />
          ) : error ? (
            <ErrorState message={t('admin.failedTrips')} onRetry={fetchTrips} retryLabel={t('common.retry')} />
          ) : trips.length === 0 ? (
            <EmptyState icon={<Plane className="h-8 w-8" />} title={hasFilters ? t('admin.noTripResults') : t('empty.noTrips')} />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-left">
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.traveler')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('trips.route')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('trips.dates')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('trips.weight')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('trips.price')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('trips.status')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200 text-right">{t('admin.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {trips.map((trip) => (
                      <tr key={trip.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{trip.profiles?.full_name ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{trip.origin} → {trip.destination}</td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{trip.departure_date} → {trip.arrival_date}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{trip.available_weight_kg} kg</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{trip.price_per_kg}/kg</td>
                        <td className="px-4 py-3"><span className={tripStatusBadgeClass(trip.status)}>{tripStatusLabel(trip.status, t)}</span></td>
                        <td className="px-4 py-3 text-right">
                          {(trip.status === 'draft' || trip.status === 'published' || trip.status === 'in_progress') && (
                            <button onClick={() => handleCancelClick(trip)} disabled={cancelling} className="btn-ghost btn-sm text-error-600" title={t('trips.cancel')}>
                              <XCircle className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-slate-100 md:hidden">
                {trips.map((trip) => (
                  <div key={trip.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{trip.origin} → {trip.destination}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{trip.profiles?.full_name ?? '—'}</p>
                      </div>
                      <span className={tripStatusBadgeClass(trip.status)}>{tripStatusLabel(trip.status, t)}</span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      {trip.departure_date} → {trip.arrival_date} · {trip.available_weight_kg} kg · {trip.price_per_kg}/kg
                    </div>
                    {(trip.status === 'draft' || trip.status === 'published' || trip.status === 'in_progress') && (
                      <button onClick={() => handleCancelClick(trip)} disabled={cancelling} className="btn-ghost btn-sm text-error-600 mt-2" title={t('trips.cancel')}>
                        <XCircle className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 px-4 py-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.page')} {page + 1}</p>
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary btn-sm">{t('common.previous')}</button>
                  <button onClick={() => setPage((p) => p + 1)} disabled={trips.length < PAGE_SIZE} className="btn-secondary btn-sm">{t('common.next')}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={handleCancelClose}
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-error-100 dark:bg-error-900/30">
                  <AlertTriangle className="h-5 w-5 text-error-600 dark:text-error-400" />
                </div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {t('trips.cancel')}
                </h2>
              </div>
              <button
                onClick={handleCancelClose}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('admin.cancelTripConfirm')}
              </p>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                <div className="flex justify-between gap-4">
                  <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('admin.traveler')}</span>
                  <span className="text-sm font-medium text-slate-900 dark:text-white text-right">{cancelTarget.profiles?.full_name ?? '—'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('trips.route')}</span>
                  <span className="text-sm font-medium text-slate-900 dark:text-white text-right">{cancelTarget.origin} → {cancelTarget.destination}</span>
                </div>
              </div>

              {cancelError && (
                <p className="text-sm text-error-600 dark:text-error-400">{cancelError}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 dark:border-slate-700 px-6 py-4">
              <button
                onClick={handleCancelClose}
                disabled={cancelling}
                className="btn-secondary"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCancelConfirm}
                disabled={cancelling}
                className="inline-flex items-center gap-2 rounded-lg bg-error-600 px-4 py-2 text-sm font-semibold text-white hover:bg-error-700 dark:bg-error-600 dark:hover:bg-error-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <XCircle className="h-4 w-4" />
                {t('trips.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div
            className={`flex items-center gap-3 rounded-xl px-5 py-3 shadow-lg border ${
              toast.type === 'success'
                ? 'bg-success-50 dark:bg-success-900/30 border-success-200 dark:border-success-700 text-success-800 dark:text-success-200'
                : 'bg-error-50 dark:bg-error-900/30 border-error-200 dark:border-error-700 text-error-800 dark:text-error-200'
            }`}
          >
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function tripStatusLabel(s: TripStatus, t: (k: TranslationKey) => string): string {
  switch (s) {
    case 'draft': return t('marketplace.status.draft');
    case 'published': return t('marketplace.status.published');
    case 'in_progress': return t('marketplace.status.in_progress');
    case 'completed': return t('marketplace.status.completed');
    case 'cancelled': return t('marketplace.status.cancelled');
  }
}
function tripStatusBadgeClass(s: TripStatus): string {
  switch (s) {
    case 'draft': return 'badge-neutral';
    case 'published': return 'badge-success';
    case 'in_progress': return 'badge-accent';
    case 'completed': return 'badge-primary';
    case 'cancelled': return 'badge-error';
  }
}
