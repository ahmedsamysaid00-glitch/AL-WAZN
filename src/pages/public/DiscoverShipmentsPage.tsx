import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { LanguageSwitcher, ThemeToggle } from '@/components/shared/Navigation';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Package, MapPin, Calendar, Weight, Search, X, Luggage, ArrowRight, Plane } from 'lucide-react';
import type { ListingWithSender, TripWithTraveler } from '@/types/database';

export function DiscoverShipmentsPage() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const [listings, setListings] = useState<ListingWithSender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState({ origin: '', destination: '', preferred_date: '', max_weight: '' });

  const fetchListings = useCallback(async () => {
    setLoading(true);
    setError(false);
    let query = supabase.from('sender_listings').select('*, profiles(full_name)').eq('status', 'published').order('created_at', { ascending: false });
    if (filters.origin.trim()) query = query.ilike('origin', `%${filters.origin.trim()}%`);
    if (filters.destination.trim()) query = query.ilike('destination', `%${filters.destination.trim()}%`);
    if (filters.preferred_date) query = query.lte('preferred_date', filters.preferred_date);
    if (filters.max_weight) query = query.lte('weight_kg', parseFloat(filters.max_weight));

    const { data, error: err } = await query;
    if (err) { setError(true); setLoading(false); return; }
    setListings((data as ListingWithSender[]) ?? []);
    setLoading(false);
  }, [filters]);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  const clearFilters = () => setFilters({ origin: '', destination: '', preferred_date: '', max_weight: '' });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white"><Luggage className="h-5 w-5" /></div>
            <span className="text-lg font-bold text-slate-900 dark:text-white">{t('brand.name')}</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            <Link to="/trips" className="btn-ghost btn-sm hidden sm:inline-flex">{t('discover.tripsTitle')}</Link>
            <Link to="/login" className="btn-primary btn-sm">{t('nav.login')}</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('discover.shipmentsTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('discover.shipmentsSubtitle')}</p>
        </div>

        <div className="card mb-6 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input type="text" placeholder={t('discover.filterOrigin')} value={filters.origin} onChange={(e) => setFilters({ ...filters, origin: e.target.value })} className="input" />
            <input type="text" placeholder={t('discover.filterDestination')} value={filters.destination} onChange={(e) => setFilters({ ...filters, destination: e.target.value })} className="input" />
            <input type="date" placeholder={t('discover.filterPreferredDate')} value={filters.preferred_date} onChange={(e) => setFilters({ ...filters, preferred_date: e.target.value })} className="input" />
            <input type="number" placeholder={t('discover.filterMaxWeight')} value={filters.max_weight} onChange={(e) => setFilters({ ...filters, max_weight: e.target.value })} className="input" />
            <div className="flex gap-2">
              <button onClick={fetchListings} className="btn-primary btn-sm flex-1"><Search className="h-4 w-4" />{t('discover.search')}</button>
              <button onClick={clearFilters} className="btn-ghost btn-sm"><X className="h-4 w-4" /></button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="card"><LoadingState label={t('discover.loading')} /></div>
        ) : error ? (
          <div className="card"><ErrorState message={t('discover.failed')} onRetry={fetchListings} retryLabel={t('common.retry')} /></div>
        ) : listings.length === 0 ? (
          <div className="card"><EmptyState icon={<Package className="h-8 w-8" />} title={filters.origin || filters.destination || filters.preferred_date || filters.max_weight ? t('discover.shipmentsNoResults') : t('discover.shipmentsEmpty')} /></div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <Link key={listing.id} to={`/shipments/${listing.id}`} className="card card-hover p-5 animate-fade-in">
                <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">{listing.product_name}</p>
                <div className="mb-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <MapPin className="h-4 w-4 shrink-0 text-primary-500" />
                  <span className="break-anywhere">{listing.origin}</span> <ArrowRight className={`h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500 ${arrow}`} /> <span className="break-anywhere">{listing.destination}</span>
                </div>
                <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-1.5"><Weight className="h-3.5 w-3.5" />{listing.weight_kg} {t('discover.kg')} · {t('discover.quantity')}: {listing.quantity}</div>
                  {listing.preferred_date && <div className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{listing.preferred_date}</div>}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-3">
                  {listing.budget != null ? <span className="text-sm font-bold text-primary-600 dark:text-primary-400">{t('discover.budget')}: {listing.budget}</span> : <span />}
                  <span className="text-xs text-slate-400 dark:text-slate-500 truncate">{listing.profiles?.full_name ?? t('discover.sender')}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ListingDetailPage() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const { profile } = useAuth();
  const { id } = useParams();
  const [listing, setListing] = useState<ListingWithSender | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [compatibleTrips, setCompatibleTrips] = useState<TripWithTraveler[]>([]);
  const [tripsLoading, setTripsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) { setNotFound(true); setLoading(false); return; }
      const { data, error: err } = await supabase.from('sender_listings').select('*, profiles(full_name)').eq('id', id).maybeSingle();
      if (err || !data) { setNotFound(true); setLoading(false); return; }
      const l = data as ListingWithSender;
      if (l.status !== 'published') {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || (user.id !== l.sender_id)) { setNotFound(true); setLoading(false); return; }
      }
      setListing(l);
      setLoading(false);

      // Fetch compatible published trips for the listing owner (sender)
      if (profile?.id === l.sender_id) {
        setTripsLoading(true);
        const { data: trips } = await supabase
          .from('trips')
          .select('*, profiles!inner(full_name)')
          .eq('status', 'published')
          .neq('traveler_id', profile.id)
          .ilike('destination', `%${l.destination}%`)
          .order('departure_date', { ascending: true });
        setCompatibleTrips((trips as TripWithTraveler[]) ?? []);
        setTripsLoading(false);
      }
    })();
  }, [id, profile?.id]);

  if (loading) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center"><LoadingState /></div>
  );
  if (notFound || !listing) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
      <div className="card p-8 text-center"><p className="text-slate-600 dark:text-slate-400">{t('shipments.notFound')}</p><Link to="/shipments" className="btn-secondary btn-sm mt-4">{t('listing.backToDiscover')}</Link></div>
    </div>
  );

  const isOwner = profile?.id === listing.sender_id;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white"><Luggage className="h-5 w-5" /></div>
            <span className="text-lg font-bold text-slate-900 dark:text-white">{t('brand.name')}</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            {profile && <Link to="/dashboard" className="btn-ghost btn-sm hidden sm:inline-flex">{t('nav.dashboard')}</Link>}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Link to="/shipments" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">← {t('listing.backToDiscover')}</Link>

        <div className="card p-6 space-y-6">
          <div>
            <h1 className="break-anywhere text-2xl font-bold text-slate-900 dark:text-white">{listing.product_name}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{listing.profiles?.full_name ?? t('discover.sender')}</p>
          </div>

          <p className="text-sm text-slate-600 dark:text-slate-400">{listing.description}</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <DetailItem label={t('listing.detailRoute')} value={`${listing.origin} ${arrow === 'rotate-180' ? '←' : '→'} ${listing.destination}`} />
            <DetailItem label={t('discover.quantity')} value={String(listing.quantity)} />
            <DetailItem label={t('discover.weight')} value={`${listing.weight_kg} ${t('discover.kg')}`} />
            {listing.budget != null && <DetailItem label={t('discover.budget')} value={String(listing.budget)} />}
            {listing.preferred_date && <DetailItem label={t('discover.filterPreferredDate')} value={listing.preferred_date} />}
          </div>

          {listing.notes && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">{t('listing.detailNotes')}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">{listing.notes}</p>
            </div>
          )}
        </div>

        {/* Compatible trips section for listing owner */}
        {isOwner && (
          <div className="mt-6 space-y-4">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
                <Plane className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                {t('collab.compatibleTrips')}
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('collab.compatibleTripsDesc')}</p>
            </div>
            {tripsLoading ? (
              <div className="card"><LoadingState /></div>
            ) : compatibleTrips.length === 0 ? (
              <div className="card"><EmptyState icon={<Plane className="h-8 w-8" />} title={t('collab.noCompatibleTrips')} /></div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {compatibleTrips.map((trip) => (
                  <Link key={trip.id} to={`/trips/${trip.id}`} className="card card-hover p-4 animate-fade-in">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                      <MapPin className="h-4 w-4 shrink-0 text-primary-500" />
                      <span className="break-anywhere">{trip.origin}</span> <ArrowRight className={`h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500 ${arrow}`} /> <span className="break-anywhere">{trip.destination}</span>
                    </div>
                    <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <div className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{trip.departure_date} → {trip.arrival_date}</div>
                      <div className="flex items-center gap-1.5"><Weight className="h-3.5 w-3.5" />{trip.available_weight_kg} {t('discover.kg')}</div>
                    </div>
                    <div className="mt-2 flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-2">
                      <span className="text-sm font-bold text-primary-600 dark:text-primary-400">{trip.price_per_kg} {t('discover.perKg')}</span>
                      <span className="text-xs text-slate-400 dark:text-slate-500 truncate">{trip.profiles?.full_name ?? t('discover.traveler')}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1.5 text-sm font-semibold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
