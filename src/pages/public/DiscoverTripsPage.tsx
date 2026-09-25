import { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { LanguageSwitcher, ThemeToggle } from '@/components/shared/Navigation';
import { LoadingState, ErrorState, EmptyState, Spinner } from '@/components/ui/States';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Pagination } from '@/components/ui/Pagination';
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import { Plane, MapPin, Calendar, Weight, Search, X, Luggage, ArrowRight, ArrowLeft, Handshake, ShieldAlert, Package, Clock, CheckCircle2, XCircle, Plus, Eye, Pencil } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { TripWithTraveler, SenderListing, CollaborationWithDetails, CollaborationStatus } from '@/types/database';

export function DiscoverTripsPage() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<TripWithTraveler[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [filters, setFilters] = useState({ origin: '', destination: '', departure_date: '', min_weight: '' });
  const PAGE_SIZE = 9;

  // Sender collaboration state
  const [hasPublishedListing, setHasPublishedListing] = useState(false);
  const [existingCollabs, setExistingCollabs] = useState<Record<string, { id: string; status: CollaborationStatus }>>({});

  const isVerifiedSender = profile?.role === 'sender' && profile?.verification_status === 'approved' && profile?.identity_verified === true && profile?.account_status === 'active';

  const fetchTrips = useCallback(async (pageNum: number) => {
    setLoading(true);
    setError(false);
    let query = supabase.from('trips').select('*, profiles(full_name)', { count: 'exact' }).eq('status', 'published').order('created_at', { ascending: false });
    if (filters.origin.trim()) query = query.ilike('origin', `%${filters.origin.trim()}%`);
    if (filters.destination.trim()) query = query.ilike('destination', `%${filters.destination.trim()}%`);
    if (filters.departure_date) query = query.gte('departure_date', filters.departure_date);
    if (filters.min_weight) query = query.gte('available_weight_kg', parseFloat(filters.min_weight));

    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error: err, count } = await query.range(from, to);
    if (err) { setError(true); setLoading(false); return; }
    const tripData = (data as TripWithTraveler[]) ?? [];
    setTrips(tripData);
    setTotalCount(count ?? 0);

    // Fetch sender's published listings + existing collaborations for these trips
    if (isVerifiedSender && profile && tripData.length > 0) {
      const { count: slCount } = await supabase
        .from('sender_listings')
        .select('id', { count: 'exact', head: true })
        .eq('sender_id', profile.id)
        .eq('status', 'published');
      setHasPublishedListing((slCount ?? 0) > 0);

      const tripIds = tripData.map((tp) => tp.id);
      const { data: collabs } = await supabase
        .from('collaborations')
        .select('id, status, trip_id')
        .eq('sender_id', profile.id)
        .in('status', ['pending', 'accepted'])
        .in('trip_id', tripIds);
      const collabMap: Record<string, { id: string; status: CollaborationStatus }> = {};
      for (const c of (collabs ?? []) as { id: string; status: CollaborationStatus; trip_id: string }[]) {
        collabMap[c.trip_id] = { id: c.id, status: c.status };
      }
      setExistingCollabs(collabMap);
    }

    setLoading(false);
  }, [filters, isVerifiedSender, profile]);

  // Reset to page 0 when filters change
  useEffect(() => { setPage(0); }, [filters]);

  useEffect(() => { fetchTrips(page); }, [fetchTrips, page]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const clearFilters = () => setFilters({ origin: '', destination: '', departure_date: '', min_weight: '' });

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
            {profile ? (
              <Link to="/dashboard" className="btn-ghost btn-sm hidden sm:inline-flex">{t('nav.dashboard')}</Link>
            ) : (
              <Link to="/login" className="btn-primary btn-sm">{t('nav.login')}</Link>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('discover.tripsTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('discover.tripsSubtitle')}</p>
        </div>

        <div className="card mb-6 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input type="text" placeholder={t('discover.filterOrigin')} value={filters.origin} onChange={(e) => setFilters({ ...filters, origin: e.target.value })} className="input" />
            <input type="text" placeholder={t('discover.filterDestination')} value={filters.destination} onChange={(e) => setFilters({ ...filters, destination: e.target.value })} className="input" />
            <input type="date" value={filters.departure_date} onChange={(e) => setFilters({ ...filters, departure_date: e.target.value })} className="input" />
            <input type="number" placeholder={t('discover.filterMinWeight')} value={filters.min_weight} onChange={(e) => setFilters({ ...filters, min_weight: e.target.value })} className="input" />
            <div className="flex gap-2">
              <button onClick={() => { setPage(0); fetchTrips(0); }} className="btn-primary btn-sm flex-1"><Search className="h-4 w-4" />{t('discover.search')}</button>
              <button onClick={clearFilters} className="btn-ghost btn-sm"><X className="h-4 w-4" /></button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="card"><LoadingState label={t('discover.loading')} /></div>
        ) : error ? (
          <div className="card"><ErrorState message={t('discover.failed')} onRetry={() => fetchTrips(page)} retryLabel={t('common.retry')} /></div>
        ) : trips.length === 0 ? (
          <div className="card"><EmptyState icon={<Plane className="h-8 w-8" />} title={filters.origin || filters.destination || filters.departure_date || filters.min_weight ? t('discover.tripsNoResults') : t('discover.tripsEmpty')} /></div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip) => {
              const isOwnTrip = profile?.id === trip.traveler_id;
              const existingCollab = existingCollabs[trip.id];

              return (
                <div key={trip.id} className="card p-5 animate-fade-in flex flex-col">
                  <Link to={`/trips/${trip.id}`} className="flex-1">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                      <MapPin className="h-4 w-4 shrink-0 text-primary-500" />
                      <span className="break-anywhere">{trip.origin}</span> <ArrowRight className={`h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500 ${arrow}`} /> <span className="break-anywhere">{trip.destination}</span>
                    </div>
                    <div className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <div className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{trip.departure_date} → {trip.arrival_date}</div>
                      <div className="flex items-center gap-1.5"><Weight className="h-3.5 w-3.5" />{trip.available_weight_kg} {t('discover.kg')}</div>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-3">
                      <span className="text-sm font-bold text-primary-600 dark:text-primary-400">{trip.price_per_kg} {t('discover.perKg')}</span>
                      <span className="text-xs text-slate-400 dark:text-slate-500 truncate">{trip.profiles?.full_name ?? t('discover.traveler')}</span>
                    </div>
                  </Link>

                  {/* Action buttons row */}
                  <div className="mt-3 flex gap-2">
                    <Link to={`/trips/${trip.id}`} className="btn-ghost btn-sm flex-1">
                      <Eye className="h-4 w-4" />
                      {t('trips.view')}
                    </Link>

                    {/* Collaboration action for verified senders */}
                    {isVerifiedSender && !isOwnTrip && !existingCollab && (
                      hasPublishedListing ? (
                        <button
                          onClick={() => navigate(`/trips/${trip.id}`)}
                          className="btn-primary btn-sm flex-1"
                        >
                          <Handshake className="h-4 w-4" />
                          {t('collab.requestCollab')}
                        </button>
                      ) : (
                        <Link to="/dashboard/shipments/new" className="btn-secondary btn-sm flex-1">
                          <Plus className="h-4 w-4" />
                          {t('collab.createShipmentFirst')}
                        </Link>
                      )
                    )}
                  </div>

                  {/* Existing collaboration status */}
                  {isVerifiedSender && !isOwnTrip && existingCollab && (
                    <Link to={`/dashboard/collaborations/${existingCollab.id}`} className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        {existingCollab.status === 'pending' ? (
                          <Clock className="h-4 w-4 text-warning-500" />
                        ) : existingCollab.status === 'accepted' ? (
                          <CheckCircle2 className="h-4 w-4 text-success-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-error-500" />
                        )}
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {existingCollab.status === 'pending'
                            ? t('collab.waitingTraveler')
                            : existingCollab.status === 'accepted'
                              ? t('collab.accepted')
                              : t('collab.status.rejected')}
                        </span>
                      </div>
                      <ArrowRight className={`h-4 w-4 text-slate-400 dark:text-slate-500 ${arrow}`} />
                    </Link>
                  )}

                  {/* Verification gate for unverified senders */}
                  {profile?.role === 'sender' && !isVerifiedSender && !isOwnTrip && (
                    <Link to="/dashboard/verification" className="mt-3 flex items-center gap-2 rounded-lg border-2 border-warning-200 bg-warning-50 px-3 py-2 text-sm">
                      <ShieldAlert className="h-4 w-4 shrink-0 text-warning-600" />
                      <span className="font-medium text-slate-700 dark:text-slate-300">{t('collab.notVerified')}</span>
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && !error && totalPages > 1 && (
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} t={t} rtl={dir === 'rtl'} />
        )}
      </div>
    </div>
  );
}

export function TripDetailPage() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const { profile } = useAuth();
  const { id } = useParams();
  const [trip, setTrip] = useState<TripWithTraveler | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Collaboration request state
  const [showCollabForm, setShowCollabForm] = useState(false);
  const [listings, setListings] = useState<SenderListing[]>([]);
  const [selectedListing, setSelectedListing] = useState('');
  const [proposedWeight, setProposedWeight] = useState('');
  const [proposedPrice, setProposedPrice] = useState('');
  const [collabMessage, setCollabMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [collabError, setCollabError] = useState<string | null>(null);
  const [collabSuccess, setCollabSuccess] = useState(false);
  const [incomingCollabs, setIncomingCollabs] = useState<CollaborationWithDetails[]>([]);
  const [existingCollab, setExistingCollab] = useState<{ id: string; status: CollaborationStatus } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  useEffect(() => {
    (async () => {
      if (!id) { setNotFound(true); setLoading(false); return; }
      const { data, error: err } = await supabase.from('trips').select('*, profiles(full_name)').eq('id', id).maybeSingle();
      if (err || !data) { setNotFound(true); setLoading(false); return; }
      const tripData = data as TripWithTraveler;
      if (tripData.status !== 'published') {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || (user.id !== tripData.traveler_id)) { setNotFound(true); setLoading(false); return; }
      }
      setTrip(tripData);
      setProposedWeight(String(tripData.available_weight_kg));
      setProposedPrice(String(tripData.price_per_kg));
      setLoading(false);

      // Fetch sender's published listings + any active collaboration if user is a sender viewing someone else's trip
      if (profile?.role === 'sender' && profile.id !== tripData.traveler_id) {
        const { data: sl } = await supabase.from('sender_listings').select('*').eq('sender_id', profile.id).eq('status', 'published').order('created_at', { ascending: false });
        setListings((sl as SenderListing[]) ?? []);

        const { data: existing } = await supabase
          .from('collaborations')
          .select('id, status')
          .eq('trip_id', tripData.id)
          .eq('sender_id', profile.id)
          .in('status', ['pending', 'accepted'])
          .maybeSingle();
        setExistingCollab(existing as { id: string; status: CollaborationStatus } | null);
      }

      // Fetch incoming collaborations if user owns this trip (limited to most recent 20)
      if (profile?.id === tripData.traveler_id) {
        const { data: collabs } = await supabase
          .from('collaborations')
          .select('*, sender_listings!inner(product_name, weight_kg, origin, destination, profiles(full_name))')
          .eq('trip_id', tripData.id)
          .order('created_at', { ascending: false })
          .limit(20);
        setIncomingCollabs((collabs as CollaborationWithDetails[]) ?? []);
      }
    })();
  }, [id, profile?.id, profile?.role]);

  const isVerifiedSender = profile?.role === 'sender' && profile?.verification_status === 'approved' && profile?.identity_verified === true && profile?.account_status === 'active';
  const isOwnTrip = profile?.id === trip?.traveler_id;
  const canRequestCollab = isVerifiedSender && !isOwnTrip && trip?.status === 'published' && !existingCollab;
  const canManageTrip = isOwnTrip && (trip?.status === 'draft' || trip?.status === 'published');

  const handleCancelTrip = async () => {
    if (!trip) return;
    setShowCancelConfirm(false);
    setCancelling(true);
    const { error: e } = await supabase.from('trips').update({ status: 'cancelled' }).eq('id', trip.id);
    setCancelling(false);
    if (e) {
      showToast('error', t('trips.cancelFailed'));
      return;
    }
    showToast('success', t('trips.cancelSuccess'));
    setTrip({ ...trip, status: 'cancelled' });
  };

  const handleCollabSubmit = async () => {
    if (!trip || !profile) return;
    setCollabError(null);
    setCollabSuccess(false);

    if (!selectedListing) { setCollabError('collab.selectListing'); return; }
    const w = parseFloat(proposedWeight);
    if (!proposedWeight || isNaN(w) || w <= 0) { setCollabError('trips.form.weightPositive'); return; }
    const p = parseFloat(proposedPrice);
    if (isNaN(p) || p < 0) { setCollabError('trips.form.priceNonNegative'); return; }

    setSubmitting(true);
    const insertPayload = {
      trip_id: trip.id,
      sender_listing_id: selectedListing,
      traveler_id: trip.traveler_id,
      sender_id: profile.id,
      message: collabMessage.trim() || null,
      proposed_weight_kg: w,
      proposed_price: p,
      status: 'pending' as const,
    };
    const { data: newCollab, error: err } = await supabase
      .from('collaborations')
      .insert(insertPayload)
      .select('id')
      .maybeSingle();
    setSubmitting(false);

    if (err) {
      if (err.code === '23505' || err.message.includes('duplicate') || err.message.includes('unique')) {
        setCollabError(t('collab.duplicateActive'));
        const { data: existing } = await supabase
          .from('collaborations')
          .select('id, status')
          .eq('trip_id', trip.id)
          .eq('sender_id', profile.id)
          .in('status', ['pending', 'accepted'])
          .maybeSingle();
        if (existing) setExistingCollab(existing as { id: string; status: CollaborationStatus } | null);
      } else {
        setCollabError(t('collab.createFailed'));
      }
      return;
    }

    let collabId: string | null = null;
    if (newCollab && typeof newCollab === 'object' && 'id' in newCollab) {
      collabId = (newCollab as { id: string }).id;
    } else {
      const { data: created, error: qErr } = await supabase
        .from('collaborations')
        .select('id, status')
        .eq('trip_id', trip.id)
        .eq('sender_id', profile.id)
        .eq('sender_listing_id', selectedListing)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (qErr || !created) {
        setCollabError(t('collab.createFailed'));
        return;
      }
      collabId = (created as { id: string }).id;
    }

    setCollabSuccess(true);
    setExistingCollab({ id: collabId, status: 'pending' });
    setShowCollabForm(false);
    setSelectedListing('');
    setCollabMessage('');
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center"><LoadingState /></div>
  );
  if (notFound || !trip) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
      <div className="card p-8 text-center"><p className="text-slate-600 dark:text-slate-400">{t('trips.notFound')}</p><Link to="/trips" className="btn-secondary btn-sm mt-4">{t('trip.backToDiscover')}</Link></div>
    </div>
  );

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
        <Link to="/trips" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className={`h-4 w-4 ${arrow}`} />
          {t('trip.backToDiscover')}
        </Link>

        {collabSuccess && <div className="alert-success mb-4">{t('collab.createSuccess')}</div>}

        <div className="card p-6 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('trip.detailTitle')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{trip.profiles?.full_name ?? t('discover.traveler')}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <DetailItem icon={<MapPin />} label={t('trip.detailRoute')} value={`${trip.origin} ${arrow === 'rotate-180' ? '←' : '→'} ${trip.destination}`} />
            <DetailItem icon={<Calendar />} label={t('trip.detailSchedule')} value={`${trip.departure_date} → ${trip.arrival_date}`} />
            <DetailItem icon={<Weight />} label={t('trip.detailCapacity')} value={`${trip.available_weight_kg} ${t('discover.kg')}`} />
            <DetailItem icon={<span className="text-sm font-bold">$</span>} label={t('trip.detailPricing')} value={`${trip.price_per_kg} ${t('discover.perKg')}`} />
          </div>

          {trip.notes && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">{t('trip.detailNotes')}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">{trip.notes}</p>
            </div>
          )}
        </div>

        {/* Traveler management controls for trip owner */}
        {canManageTrip && (
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to={`/dashboard/trips/${trip.id}/edit`} className="btn-secondary">
              <Pencil className="h-4 w-4" />
              {t('trips.edit')}
            </Link>
            <button onClick={() => setShowCancelConfirm(true)} disabled={cancelling} className="btn-ghost text-error-600">
              <XCircle className="h-4 w-4" />
              {cancelling ? <Spinner size="sm" /> : t('trips.cancel')}
            </button>
          </div>
        )}

        {/* Collaboration request section for senders */}
        {canRequestCollab && (
          <div className="mt-6 space-y-4">
            {!showCollabForm ? (
              <button onClick={() => setShowCollabForm(true)} className="btn-primary w-full">
                <Handshake className="h-5 w-5" />
                {t('collab.requestCollab')}
              </button>
            ) : (
              <div className="card p-6 space-y-4">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('collab.requestTitle')}</h2>

                {collabError && (
                  <div className="alert-error">
                    {collabError.startsWith('collab.') || collabError.startsWith('trips.') ? t(collabError as TranslationKey) : collabError}
                  </div>
                )}

                {listings.length === 0 ? (
                  <div className="alert-warning">
                    <p className="text-sm">{t('collab.noListings')}</p>
                    <Link to="/dashboard/shipments/new" className="btn-secondary btn-sm mt-2">{t('shipments.create')}</Link>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="label">{t('collab.selectListing')}</label>
                      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{t('collab.selectListingHint')}</p>
                      <select value={selectedListing} onChange={(e) => setSelectedListing(e.target.value)} className="input">
                        <option value="">—</option>
                        {listings.map((l) => (
                          <option key={l.id} value={l.id}>{l.product_name} — {l.origin} → {l.destination} ({l.weight_kg} kg)</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">{t('collab.proposedWeightLabel')}</label>
                        <input type="number" step="0.1" value={proposedWeight} onChange={(e) => setProposedWeight(e.target.value)} className="input" />
                      </div>
                      <div>
                        <label className="label">{t('collab.proposedPriceLabel')}</label>
                        <input type="number" step="0.01" value={proposedPrice} onChange={(e) => setProposedPrice(e.target.value)} className="input" />
                      </div>
                    </div>
                    <div>
                      <label className="label">{t('collab.messageLabel')}</label>
                      <textarea value={collabMessage} onChange={(e) => setCollabMessage(e.target.value)} className="input min-h-[60px] resize-y" placeholder={t('collab.messagePlaceholder')} />
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button onClick={handleCollabSubmit} disabled={submitting} className="btn-primary">
                        {submitting ? <Spinner size="sm" /> : t('collab.submit')}
                      </button>
                      <button onClick={() => setShowCollabForm(false)} className="btn-secondary">{t('common.cancel')}</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Existing active collaboration status for senders */}
        {isVerifiedSender && !isOwnTrip && trip.status === 'published' && existingCollab && (
          <div className="card mt-6 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {existingCollab.status === 'pending' ? (
                  <Clock className="h-5 w-5 text-warning-500" />
                ) : existingCollab.status === 'accepted' ? (
                  <CheckCircle2 className="h-5 w-5 text-success-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-error-500" />
                )}
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {existingCollab.status === 'pending'
                      ? t('collab.waitingTraveler')
                      : existingCollab.status === 'accepted'
                        ? t('collab.accepted')
                        : t('collab.status.rejected')}
                  </p>
                </div>
              </div>
              <Link to={`/dashboard/collaborations/${existingCollab.id}`} className="btn-ghost btn-sm">
                {t('collab.view')}
              </Link>
            </div>
          </div>
        )}

        {/* Verification gate for unverified senders */}
        {profile?.role === 'sender' && !isVerifiedSender && !isOwnTrip && trip.status === 'published' && (
          <div className="card mt-6 border-2 border-warning-200 bg-warning-50 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 shrink-0 text-warning-600" />
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{t('collab.notVerified')}</p>
                <Link to="/dashboard/verification" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-primary-600 dark:text-primary-400">
                  {t('nav.verification')} <ArrowRight className={`h-4 w-4 ${arrow}`} />
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Incoming collaborations for trip owner */}
        {isOwnTrip && incomingCollabs.length > 0 && (
          <div className="mt-6 space-y-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('collab.incomingRequests')} ({incomingCollabs.length})</h2>
            {incomingCollabs.map((c) => (
              <div key={c.id} className="card p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                      <Package className="h-4 w-4 shrink-0 text-accent-500" />
                      <span className="break-anywhere">{c.sender_listings?.product_name ?? '—'}</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{c.proposed_weight_kg} kg · {c.proposed_price}</p>
                    {c.message && <p className="text-xs italic text-slate-400 dark:text-slate-500">"{c.message}"</p>}
                  </div>
                  <Link to={`/dashboard/collaborations/${c.id}`} className="btn-ghost btn-sm">{t('collab.view')}</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Toast toast={toast} onDismiss={dismissToast} />

      {showCancelConfirm && (
        <ConfirmDialog
          open={showCancelConfirm}
          title={t('common.confirmTitle')}
          message={t('trips.cancelConfirm')}
          confirmLabel={t('trips.cancel')}
          cancelLabel={t('common.cancel')}
          onConfirm={handleCancelTrip}
          onCancel={() => setShowCancelConfirm(false)}
          loading={cancelling}
          destructive
        />
      )}
    </div>
  );
}

function DetailItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">{icon}{label}</div>
      <p className="mt-1.5 text-sm font-semibold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
