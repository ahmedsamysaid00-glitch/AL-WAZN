import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { UserLayout } from './UserLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Pagination } from '@/components/ui/Pagination';
import { Package, Plus, Pencil, Eye, XCircle, MapPin, Calendar, Weight } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { SenderListing, ListingStatus } from '@/types/database';

const PAGE_SIZE = 10;

export function UserShipmentsPage() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const { profile } = useAuth();
  const [listings, setListings] = useState<SenderListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const fetchingRef = useRef(false);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const fetchListings = useCallback(async (pageNum: number) => {
    if (!profile?.id || fetchingRef.current) return;
    fetchingRef.current = true;
    setError(false);
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error: err, count } = await supabase
      .from('sender_listings')
      .select('*', { count: 'exact' })
      .eq('sender_id', profile.id)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (err) { setError(true); fetchingRef.current = false; return; }
    setListings((data as SenderListing[]) ?? []);
    setTotalCount(count ?? 0);
    fetchingRef.current = false;
  }, [profile?.id]);

  const fetchListingsInitial = useCallback(async () => {
    if (!profile?.id) { setLoading(false); return; }
    setLoading(true);
    await fetchListings(0);
    setLoading(false);
  }, [profile?.id, fetchListings]);

  useEffect(() => { fetchListingsInitial(); }, [fetchListingsInitial]);

  useRealtimeRefresh(
    [{ table: 'sender_listings', filter: `sender_id=eq.${profile?.id ?? ''}` }],
    () => fetchListings(page),
    !!profile?.id,
  );

  const goToPage = (newPage: number) => {
    setPage(newPage);
    fetchListings(newPage);
  };

  const handleCancel = async (id: string) => {
    setPendingCancelId(null);
    setCancellingId(id);
    const { error: e } = await supabase
      .from('sender_listings')
      .update({ status: 'cancelled' })
      .eq('id', id);
    setCancellingId(null);
    if (e) { setActionError(t('shipments.cancelFailed')); return; }
    fetchListings(page);
  };

  if (loading) return (
    <UserLayout><div className="max-w-4xl"><h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('shipments.title')}</h1><div className="card"><LoadingState label={t('shipments.loading')} /></div></div></UserLayout>
  );
  if (error) return (
    <UserLayout><div className="max-w-4xl"><h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('shipments.title')}</h1><div className="card"><ErrorState message={t('shipments.failed')} onRetry={() => goToPage(page)} retryLabel={t('common.retry')} /></div></div></UserLayout>
  );

  return (
    <UserLayout>
      <div className="max-w-4xl space-y-6">
        {actionError && (
          <div className="alert-error">{actionError}</div>
        )}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('shipments.title')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('shipments.subtitle')}</p>
          </div>
          {profile?.role === 'sender' && (
            <Link to="/dashboard/shipments/new" className="btn-primary btn-sm">
              <Plus className="h-4 w-4" />
              {t('shipments.create')}
            </Link>
          )}
        </div>

        {profile?.role === 'traveler' && (
          <div className="alert-info">{t('shipments.gateTravelerDesc')}</div>
        )}

        {listings.length === 0 ? (
          <div className="card"><EmptyState icon={<Package className="h-8 w-8" />} title={t('empty.noShipments')} /></div>
        ) : (
          <div className="space-y-3">
            {listings.map((listing) => (
              <div key={listing.id} className="card p-5 animate-fade-in">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={listing.status} t={t} />
                    </div>
                    <p className="break-anywhere text-sm font-medium text-slate-900 dark:text-white">{listing.product_name}</p>
                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <MapPin className="h-4 w-4 shrink-0 text-primary-500" />
                      <span className="break-anywhere">{listing.origin}</span> <span className={arrow}>→</span> <span className="break-anywhere">{listing.destination}</span>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
                      <span className="flex items-center gap-1"><Weight className="h-3.5 w-3.5" />{listing.weight_kg} kg</span>
                      <span>{t('discover.quantity')}: {listing.quantity}</span>
                      {listing.budget != null && <span>{t('discover.budget')}: {listing.budget}</span>}
                      {listing.preferred_date && <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{listing.preferred_date}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/shipments/${listing.id}`} className="btn-ghost btn-sm"><Eye className="h-4 w-4" />{t('shipments.view')}</Link>
                    {listing.status === 'draft' || listing.status === 'published' ? (
                      <Link to={`/dashboard/shipments/${listing.id}/edit`} className="btn-secondary btn-sm"><Pencil className="h-4 w-4" />{t('shipments.edit')}</Link>
                    ) : null}
                    {listing.status === 'draft' || listing.status === 'published' ? (
                      <button onClick={() => setPendingCancelId(listing.id)} disabled={cancellingId === listing.id} className="btn-ghost btn-sm text-error-600">
                        <XCircle className="h-4 w-4" />{t('shipments.cancel')}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <Pagination page={page} totalPages={totalPages} onPageChange={goToPage} t={t} rtl={dir === 'rtl'} />
      </div>

      {pendingCancelId && (
        <ConfirmDialog
          open={!!pendingCancelId}
          title={t('common.confirmTitle')}
          message={t('shipments.cancelConfirm')}
          confirmLabel={t('shipments.cancel')}
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

function StatusBadge({ status, t }: { status: ListingStatus; t: (k: TranslationKey) => string }) {
  const map: Record<ListingStatus, string> = {
    draft: 'badge-neutral', published: 'badge-success', matched: 'badge-accent', completed: 'badge-primary', cancelled: 'badge-error',
  };
  const labelKey: Record<ListingStatus, TranslationKey> = {
    draft: 'marketplace.status.draft', published: 'marketplace.status.published', matched: 'marketplace.status.matched', completed: 'marketplace.status.completed', cancelled: 'marketplace.status.cancelled',
  };
  return <span className={map[status]}>{t(labelKey[status])}</span>;
}
