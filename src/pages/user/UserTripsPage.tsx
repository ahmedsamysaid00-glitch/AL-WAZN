import { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { UserLayout } from './UserLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Pagination } from '@/components/ui/Pagination';
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import { Plane, Plus, Pencil, Eye, XCircle, MapPin, Calendar, Weight } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { Trip, TripStatus } from '@/types/database';

const PAGE_SIZE = 10;

export function UserTripsPage() {
  const { t, dir } = useLanguage();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { toast, showToast, dismissToast } = useToast();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.role === 'sender') { navigate('/trips', { replace: true }); return; }
  }, [profile?.role, navigate]);

  const fetchTrips = useCallback(async (pageNum: number) => {
    if (!profile?.id) { return; }
    setError(false);
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error: err, count } = await supabase
      .from('trips')
      .select('*', { count: 'exact' })
      .eq('traveler_id', profile.id)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (err) { setError(true); return; }
    setTrips((data as Trip[]) ?? []);
    setTotalCount(count ?? 0);
  }, [profile?.id]);

  const fetchTripsInitial = useCallback(async (pageNum: number) => {
    if (!profile?.id) { setLoading(false); return; }
    setLoading(true);
    await fetchTrips(pageNum);
    setLoading(false);
  }, [profile?.id, fetchTrips]);

  useEffect(() => { fetchTripsInitial(page); }, [fetchTripsInitial, page]);

  useRealtimeRefresh(
    [{ table: 'trips', filter: `traveler_id=eq.${profile?.id ?? ''}` }],
    () => fetchTrips(page),
    !!profile?.id,
  );

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const handleCancel = async (id: string) => {
    setCancellingId(id);
    setPendingCancelId(null);
    const { error: e } = await supabase
      .from('trips')
      .update({ status: 'cancelled' })
      .eq('id', id);
    setCancellingId(null);
    if (e) {
      showToast('error', t('trips.cancelFailed'));
      return;
    }
    showToast('success', t('trips.cancelSuccess'));
    fetchTrips(page);
  };

  if (loading) return (
    <UserLayout><div className="max-w-4xl"><h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('trips.title')}</h1><div className="card"><LoadingState label={t('trips.loading')} /></div></div></UserLayout>
  );
  if (error) return (
    <UserLayout><div className="max-w-4xl"><h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('trips.title')}</h1><div className="card"><ErrorState message={t('trips.failed')} onRetry={() => fetchTripsInitial(page)} retryLabel={t('common.retry')} /></div></div></UserLayout>
  );

  return (
    <UserLayout>
      <div className="max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('trips.title')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('trips.subtitle')}</p>
          </div>
          {profile?.role === 'traveler' && (
            <Link to="/dashboard/trips/new" className="btn-primary btn-sm">
              <Plus className="h-4 w-4" />
              {t('trips.create')}
            </Link>
          )}
        </div>

        {trips.length === 0 ? (
          <div className="card"><EmptyState icon={<Plane className="h-8 w-8" />} title={t('empty.noTrips')} /></div>
        ) : (
          <>
            <div className="space-y-3">
              {trips.map((trip) => (
                <div key={trip.id} className="card p-5 animate-fade-in">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={trip.status} t={t} />
                      </div>
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                        <MapPin className="h-4 w-4 shrink-0 text-primary-500" />
                        <span className="break-anywhere">{trip.origin}</span> → <span className="break-anywhere">{trip.destination}</span>
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{trip.departure_date} → {trip.arrival_date}</span>
                        <span className="flex items-center gap-1"><Weight className="h-3.5 w-3.5" />{trip.available_weight_kg} kg</span>
                        <span>{trip.price_per_kg} {t('discover.perKg')}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link to={`/trips/${trip.id}`} className="btn-ghost btn-sm"><Eye className="h-4 w-4" />{t('trips.view')}</Link>
                      {trip.status === 'draft' || trip.status === 'published' ? (
                        <Link to={`/dashboard/trips/${trip.id}/edit`} className="btn-secondary btn-sm"><Pencil className="h-4 w-4" />{t('trips.edit')}</Link>
                      ) : null}
                      {trip.status === 'draft' || trip.status === 'published' ? (
                        <button onClick={() => setPendingCancelId(trip.id)} disabled={cancellingId === trip.id} className="btn-ghost btn-sm text-error-600">
                          <XCircle className="h-4 w-4" />{t('trips.cancel')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} t={t} rtl={dir === 'rtl'} />
          </>
        )}
      </div>

      <Toast toast={toast} onDismiss={dismissToast} />

      {pendingCancelId && (
        <ConfirmDialog
          open={!!pendingCancelId}
          title={t('common.confirmTitle')}
          message={t('trips.cancelConfirm')}
          confirmLabel={t('trips.cancel')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => handleCancel(pendingCancelId)}
          onCancel={() => setPendingCancelId(null)}
          loading={cancellingId === pendingCancelId}
          destructive
        />
      )}
    </UserLayout>
  );
}

function StatusBadge({ status, t }: { status: TripStatus; t: (k: TranslationKey) => string }) {
  const map: Record<TripStatus, string> = {
    draft: 'badge-neutral', published: 'badge-success', in_progress: 'badge-accent', completed: 'badge-primary', cancelled: 'badge-error',
  };
  const labelKey: Record<TripStatus, TranslationKey> = {
    draft: 'marketplace.status.draft', published: 'marketplace.status.published', in_progress: 'marketplace.status.in_progress', completed: 'marketplace.status.completed', cancelled: 'marketplace.status.cancelled',
  };
  return <span className={map[status]}>{t(labelKey[status])}</span>;
}
