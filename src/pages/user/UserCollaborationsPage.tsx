import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { UserLayout } from './UserLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Pagination } from '@/components/ui/Pagination';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { Handshake, MapPin, Package, Check, X, XCircle, ArrowRight, Inbox, Send } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { CollaborationWithDetails, CollaborationStatus } from '@/types/database';

const PAGE_SIZE = 10;

const COLLAB_SELECT = '*, trips(origin, destination, departure_date, arrival_date, available_weight_kg, price_per_kg, profiles(full_name)), sender_listings(product_name, weight_kg, origin, destination, preferred_date, profiles(full_name))';

type CollabAction = 'accept' | 'reject' | 'cancel';

export function UserCollaborationsPage() {
  const { t, dir } = useLanguage();
  const { profile } = useAuth();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const { toast, showToast, dismissToast } = useToast();

  const [outgoing, setOutgoing] = useState<CollaborationWithDetails[]>([]);
  const [incoming, setIncoming] = useState<CollaborationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [outgoingPage, setOutgoingPage] = useState(0);
  const [incomingPage, setIncomingPage] = useState(0);
  const [outgoingTotal, setOutgoingTotal] = useState(0);
  const [incomingTotal, setIncomingTotal] = useState(0);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ id: string; type: CollabAction } | null>(null);
  const fetchingRef = useRef(false);

  const outgoingTotalPages = Math.ceil(outgoingTotal / PAGE_SIZE);
  const incomingTotalPages = Math.ceil(incomingTotal / PAGE_SIZE);

  const fetchOutgoing = useCallback(async (pageNum: number) => {
    if (!profile?.id) return;
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error: err, count } = await supabase
      .from('collaborations')
      .select(COLLAB_SELECT, { count: 'exact' })
      .eq('sender_id', profile.id)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (err) { setError(true); return; }
    setOutgoing((data as CollaborationWithDetails[]) ?? []);
    setOutgoingTotal(count ?? 0);
  }, [profile?.id]);

  const fetchIncoming = useCallback(async (pageNum: number) => {
    if (!profile?.id) return;
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error: err, count } = await supabase
      .from('collaborations')
      .select(COLLAB_SELECT, { count: 'exact' })
      .eq('traveler_id', profile.id)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (err) { setError(true); return; }
    setIncoming((data as CollaborationWithDetails[]) ?? []);
    setIncomingTotal(count ?? 0);
  }, [profile?.id]);

  const fetchAll = useCallback(async (outPage: number, inPage: number) => {
    if (!profile?.id || fetchingRef.current) return;
    fetchingRef.current = true;
    setError(false);
    await Promise.all([fetchOutgoing(outPage), fetchIncoming(inPage)]);
    fetchingRef.current = false;
  }, [profile?.id, fetchOutgoing, fetchIncoming]);

  const fetchInitial = useCallback(async () => {
    setLoading(true);
    await fetchAll(0, 0);
    setLoading(false);
  }, [fetchAll]);

  useEffect(() => { fetchInitial(); }, [fetchInitial]);

  useRealtimeRefresh(
    [{ table: 'collaborations', filter: `sender_id=eq.${profile?.id ?? ''}` }, { table: 'collaborations', filter: `traveler_id=eq.${profile?.id ?? ''}` }],
    () => fetchAll(outgoingPage, incomingPage),
    !!profile?.id,
  );

  const goToOutgoingPage = (newPage: number) => {
    setOutgoingPage(newPage);
    fetchOutgoing(newPage);
  };

  const goToIncomingPage = (newPage: number) => {
    setIncomingPage(newPage);
    fetchIncoming(newPage);
  };

  const handleAction = async (id: string, type: CollabAction) => {
    setActionLoading(id);
    setPendingAction(null);
    const newStatus = type === 'accept' ? 'accepted' : type === 'reject' ? 'rejected' : 'cancelled';
    const { error: err } = await supabase.from('collaborations').update({ status: newStatus }).eq('id', id);
    setActionLoading(null);
    if (err) {
      const failedKey = type === 'accept' ? 'collab.acceptFailed' : type === 'reject' ? 'collab.rejectFailed' : 'collab.cancelFailed';
      showToast('error', t(failedKey as TranslationKey));
      return;
    }
    const successKey = type === 'accept' ? 'collab.acceptSuccess' : type === 'reject' ? 'collab.rejectSuccess' : 'collab.cancelSuccess';
    showToast('success', t(successKey as TranslationKey));
    fetchAll(outgoingPage, incomingPage);
  };

  const openConfirm = (id: string, type: CollabAction) => {
    setPendingAction({ id, type });
  };

  const closeConfirm = () => {
    setPendingAction(null);
  };

  const confirmConfig: Record<string, { messageKey: TranslationKey; confirmKey: TranslationKey; destructive: boolean }> = {
    accept: { messageKey: 'collab.acceptConfirm', confirmKey: 'collab.accept', destructive: false },
    reject: { messageKey: 'collab.rejectConfirm', confirmKey: 'collab.reject', destructive: true },
    cancel: { messageKey: 'collab.cancelConfirm', confirmKey: 'collab.cancel', destructive: true },
  };

  if (loading) return (
    <UserLayout><div className="max-w-4xl"><h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('collab.title')}</h1><div className="card"><LoadingState label={t('collab.loading')} /></div></div></UserLayout>
  );
  if (error) return (
    <UserLayout><div className="max-w-4xl"><h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('collab.title')}</h1><div className="card"><ErrorState message={t('collab.failed')} onRetry={fetchInitial} retryLabel={t('common.retry')} /></div></div></UserLayout>
  );

  return (
    <UserLayout>
      <div className="max-w-4xl space-y-8">
        {/* My Requests (as sender) */}
        <section>
          <div className="mb-4 flex items-center gap-2">
            <Send className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('collab.myRequests')}</h2>
            {outgoingTotal > 0 && <span className="badge-neutral">{outgoingTotal}</span>}
          </div>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{t('collab.myRequestsDesc')}</p>
          {outgoing.length === 0 ? (
            <div className="card"><EmptyState icon={<Handshake className="h-8 w-8" />} title={t('collab.empty')} /></div>
          ) : (
            <div className="space-y-3">
              {outgoing.map((c) => (
                <CollabCard key={c.id} collab={c} role="sender" t={t} arrow={arrow} actionLoading={actionLoading}
                  onAccept={() => {}} onReject={() => {}} onCancel={(id) => openConfirm(id, 'cancel')} />
              ))}
            </div>
          )}
          {outgoingTotalPages > 1 && (
            <Pagination page={outgoingPage} totalPages={outgoingTotalPages} onPageChange={goToOutgoingPage} t={t} rtl={dir === 'rtl'} />
          )}
        </section>

        {/* Incoming Requests (as traveler) */}
        {profile?.role === 'traveler' && (
          <section>
            <div className="mb-4 flex items-center gap-2">
              <Inbox className="h-5 w-5 text-accent-600 dark:text-accent-400" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('collab.incomingRequests')}</h2>
              {incomingTotal > 0 && <span className="badge-accent">{incomingTotal}</span>}
            </div>
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{t('collab.incomingDesc')}</p>
            {incoming.length === 0 ? (
              <div className="card"><EmptyState icon={<Inbox className="h-8 w-8" />} title={t('collab.empty')} /></div>
            ) : (
              <div className="space-y-3">
                {incoming.map((c) => (
                  <CollabCard key={c.id} collab={c} role="traveler" t={t} arrow={arrow} actionLoading={actionLoading}
                    onAccept={(id) => openConfirm(id, 'accept')} onReject={(id) => openConfirm(id, 'reject')} onCancel={() => {}} />
                ))}
              </div>
            )}
            {incomingTotalPages > 1 && (
              <Pagination page={incomingPage} totalPages={incomingTotalPages} onPageChange={goToIncomingPage} t={t} rtl={dir === 'rtl'} />
            )}
          </section>
        )}
      </div>

      <Toast toast={toast} onDismiss={dismissToast} />

      {pendingAction && confirmConfig[pendingAction.type] && (
        <ConfirmDialog
          open={!!pendingAction}
          title={t('common.confirmTitle')}
          message={t(confirmConfig[pendingAction.type].messageKey)}
          confirmLabel={t(confirmConfig[pendingAction.type].confirmKey)}
          cancelLabel={t('common.cancel')}
          onConfirm={() => handleAction(pendingAction.id, pendingAction.type)}
          onCancel={closeConfirm}
          loading={actionLoading === pendingAction.id}
          destructive={confirmConfig[pendingAction.type].destructive}
        />
      )}
    </UserLayout>
  );
}

function CollabCard({
  collab, role, t, arrow, actionLoading, onAccept, onReject, onCancel,
}: {
  collab: CollaborationWithDetails;
  role: 'sender' | 'traveler';
  t: (k: TranslationKey) => string;
  arrow: string;
  actionLoading: string | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const trip = collab.trips;
  const listing = collab.sender_listings;
  const isPending = collab.status === 'pending';

  return (
    <div className="card p-5 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <StatusBadge status={collab.status} t={t} />
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
            <span>{t('collab.proposedWeight')}: {collab.proposed_weight_kg} kg</span>
            <span>{t('collab.proposedPrice')}: {collab.proposed_price}</span>
            {collab.message && <span className="italic">"{collab.message}"</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link to={`/dashboard/collaborations/${collab.id}`} className="btn-ghost btn-sm">{t('collab.view')}</Link>
          {role === 'traveler' && isPending && (
            <>
              <button onClick={() => onAccept(collab.id)} disabled={actionLoading === collab.id} className="btn-primary btn-sm">
                <Check className="h-4 w-4" />{t('collab.accept')}
              </button>
              <button onClick={() => onReject(collab.id)} disabled={actionLoading === collab.id} className="btn-secondary btn-sm text-error-600">
                <X className="h-4 w-4" />{t('collab.reject')}
              </button>
            </>
          )}
          {role === 'sender' && isPending && (
            <button onClick={() => onCancel(collab.id)} disabled={actionLoading === collab.id} className="btn-secondary btn-sm text-error-600">
              <XCircle className="h-4 w-4" />{t('collab.cancel')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, t }: { status: CollaborationStatus; t: (k: TranslationKey) => string }) {
  const map: Record<CollaborationStatus, string> = {
    pending: 'badge-warning', accepted: 'badge-success', rejected: 'badge-error', cancelled: 'badge-neutral', completed: 'badge-primary',
  };
  const labelKey: Record<CollaborationStatus, TranslationKey> = {
    pending: 'collab.status.pending', accepted: 'collab.status.accepted', rejected: 'collab.status.rejected', cancelled: 'collab.status.cancelled', completed: 'collab.status.completed',
  };
  return <span className={map[status]}>{t(labelKey[status])}</span>;
}
