import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { UserLayout } from './UserLayout';
import { LoadingState } from '@/components/ui/States';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import { Check, X, XCircle, MapPin, Package, Calendar, Weight, DollarSign, MessageSquare, ClipboardList, ArrowLeft } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { CollaborationWithDetails, CollaborationStatus } from '@/types/database';

type ActionType = 'accept' | 'reject' | 'cancel' | 'createOrder' | null;

export function CollaborationDetailPage() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const { profile } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, showToast, dismissToast } = useToast();
  const [collab, setCollab] = useState<CollaborationWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [existingOrder, setExistingOrder] = useState<{ id: string } | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionType>(null);

  const fetchCollab = useCallback(async () => {
    if (!id) { setNotFound(true); setLoading(false); return; }
    setNotFound(false);
    const { data, error: err } = await supabase
      .from('collaborations')
      .select('*, trips(origin, destination, departure_date, arrival_date, available_weight_kg, price_per_kg, profiles(full_name)), sender_listings(product_name, weight_kg, origin, destination, preferred_date, profiles(full_name))')
      .eq('id', id)
      .maybeSingle();
    if (err || !data) { setNotFound(true); setLoading(false); return; }
    setCollab(data as CollaborationWithDetails);
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id')
      .eq('collaboration_id', id)
      .maybeSingle();
    if (!orderErr) {
      setExistingOrder(order as { id: string } | null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchCollab(); }, [fetchCollab]);

  useRealtimeRefresh(
    [
      { table: 'collaborations', filter: `id=eq.${id ?? ''}` },
      { table: 'orders', filter: `collaboration_id=eq.${id ?? ''}` },
    ],
    () => fetchCollab(),
    !!id,
  );

  const handleAccept = async () => {
    if (!collab) return;
    setActionError(null);
    setActionLoading(true);
    setPendingAction(null);
    const { error: err } = await supabase.from('collaborations').update({ status: 'accepted' }).eq('id', collab.id);
    setActionLoading(false);
    if (err) { setActionError(t('collab.acceptFailed')); showToast('error', t('collab.acceptFailed')); return; }
    showToast('success', t('collab.acceptSuccess'));
    navigate('/dashboard/collaborations');
  };

  const handleReject = async () => {
    if (!collab) return;
    setActionError(null);
    setActionLoading(true);
    setPendingAction(null);
    const { error: err } = await supabase.from('collaborations').update({ status: 'rejected' }).eq('id', collab.id);
    setActionLoading(false);
    if (err) { setActionError(t('collab.rejectFailed')); showToast('error', t('collab.rejectFailed')); return; }
    showToast('success', t('collab.rejectSuccess'));
    navigate('/dashboard/collaborations');
  };

  const handleCancel = async () => {
    if (!collab) return;
    setActionError(null);
    setActionLoading(true);
    setPendingAction(null);
    const { error: err } = await supabase.from('collaborations').update({ status: 'cancelled' }).eq('id', collab.id);
    setActionLoading(false);
    if (err) { setActionError(t('collab.cancelFailed')); showToast('error', t('collab.cancelFailed')); return; }
    showToast('success', t('collab.cancelSuccess'));
    navigate('/dashboard/collaborations');
  };

  const handleCreateOrder = async () => {
    if (!collab) return;
    setPendingAction(null);
    setOrderLoading(true);
    const { data, error: err } = await supabase.rpc('create_order_from_collaboration', { p_collaboration_id: collab.id });
    setOrderLoading(false);
    if (err) {
      setActionError(t('order.createOrderFailed'));
      showToast('error', t('order.createOrderFailed'));
      return;
    }
    if (data) {
      showToast('success', t('order.createOrderSuccess'));
      navigate(`/dashboard/orders/${(data as { id: string }).id}`);
    } else {
      fetchCollab();
    }
  };

  const actionHandlers: Record<string, () => void> = {
    accept: handleAccept,
    reject: handleReject,
    cancel: handleCancel,
    createOrder: handleCreateOrder,
  };

  const actionConfig: Record<string, { messageKey: TranslationKey; confirmKey: TranslationKey; destructive: boolean }> = {
    accept: { messageKey: 'collab.acceptConfirm', confirmKey: 'collab.accept', destructive: false },
    reject: { messageKey: 'collab.rejectConfirm', confirmKey: 'collab.reject', destructive: true },
    cancel: { messageKey: 'collab.cancelConfirm', confirmKey: 'collab.cancel', destructive: true },
    createOrder: { messageKey: 'order.createOrderConfirm', confirmKey: 'order.createOrder', destructive: false },
  };

  if (loading) return (
    <UserLayout><div className="max-w-3xl"><div className="flex justify-center py-12"><LoadingState /></div></div></UserLayout>
  );
  if (notFound || !collab) return (
    <UserLayout>
      <div className="max-w-3xl">
        <div className="card p-8 text-center">
          <p className="text-slate-600 dark:text-slate-400">{t('collab.notFound')}</p>
          <Link to="/dashboard/collaborations" className="btn-secondary btn-sm mt-4">{t('collab.backToCollabs')}</Link>
        </div>
      </div>
    </UserLayout>
  );

  const trip = collab.trips;
  const listing = collab.sender_listings;
  const isTraveler = collab.traveler_id === profile?.id;
  const isSender = collab.sender_id === profile?.id;
  const isPending = collab.status === 'pending';
  const isAccepted = collab.status === 'accepted';

  return (
    <UserLayout>
      <div className="max-w-3xl space-y-6">
        <Link to="/dashboard/collaborations" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className={`h-4 w-4 ${arrow}`} />
          {t('collab.backToCollabs')}
        </Link>

        <div className="card p-6 space-y-6">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('collab.detailTitle')}</h1>
            <StatusBadge status={collab.status} t={t} />
          </div>

          {/* Trip info */}
          {trip && (
            <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">{t('collab.trip')}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoItem icon={<MapPin />} label={t('collab.route')} value={`${trip.origin} ${arrow === 'rotate-180' ? '←' : '→'} ${trip.destination}`} />
                <InfoItem icon={<Calendar />} label={t('trip.detailSchedule')} value={`${trip.departure_date} → ${trip.arrival_date}`} />
                <InfoItem icon={<Weight />} label={t('trip.detailCapacity')} value={`${trip.available_weight_kg} kg`} />
                <InfoItem icon={<span className="text-sm font-bold">$</span>} label={t('trip.detailPricing')} value={`${trip.price_per_kg}/kg`} />
              </div>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t('collab.traveler')}: {trip.profiles?.full_name ?? '—'}</p>
            </div>
          )}

          {/* Listing info */}
          {listing && (
            <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">{t('collab.listing')}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoItem icon={<Package />} label={t('collab.product')} value={listing.product_name} />
                <InfoItem icon={<Weight />} label={t('discover.weight')} value={`${listing.weight_kg} kg`} />
                <InfoItem icon={<MapPin />} label={t('collab.route')} value={`${listing.origin} ${arrow === 'rotate-180' ? '←' : '→'} ${listing.destination}`} />
                {listing.preferred_date && <InfoItem icon={<Calendar />} label={t('discover.filterPreferredDate')} value={listing.preferred_date} />}
              </div>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t('collab.sender')}: {listing.profiles?.full_name ?? '—'}</p>
            </div>
          )}

          {/* Collaboration terms */}
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoItem icon={<Weight />} label={t('collab.proposedWeight')} value={`${collab.proposed_weight_kg} kg`} />
            <InfoItem icon={<DollarSign />} label={t('collab.proposedPrice')} value={String(collab.proposed_price)} />
            {collab.agreed_weight_kg != null && <InfoItem icon={<Weight />} label={t('collab.agreedWeight')} value={`${collab.agreed_weight_kg} kg`} />}
            {collab.agreed_price != null && <InfoItem icon={<DollarSign />} label={t('collab.agreedPrice')} value={String(collab.agreed_price)} />}
          </div>

          {/* Message */}
          {collab.message && (
            <div>
              <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300"><MessageSquare className="h-4 w-4" />{t('collab.message')}</h3>
              <p className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3 text-sm text-slate-600 dark:text-slate-400">{collab.message}</p>
            </div>
          )}

          {/* Timestamps */}
          <div className="grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2">
            <span>{t('collab.createdAt')}: {new Date(collab.created_at).toLocaleString()}</span>
            {collab.accepted_at && <span>{t('collab.acceptedAt')}: {new Date(collab.accepted_at).toLocaleString()}</span>}
            {collab.rejected_at && <span>{t('collab.rejectedAt')}: {new Date(collab.rejected_at).toLocaleString()}</span>}
            {collab.cancelled_at && <span>{t('collab.cancelledAt')}: {new Date(collab.cancelled_at).toLocaleString()}</span>}
            {collab.completed_at && <span>{t('collab.completedAt')}: {new Date(collab.completed_at).toLocaleString()}</span>}
          </div>

          {/* Actions */}
          {actionError && (
            <div className="alert-error">{actionError}</div>
          )}
          {isPending && (
            <div className="flex flex-wrap gap-3 border-t border-slate-100 dark:border-slate-700 pt-4">
              {isTraveler && (
                <>
                  <button onClick={() => setPendingAction('accept')} disabled={actionLoading} className="btn-primary btn-sm">
                    <Check className="h-4 w-4" />{t('collab.accept')}
                  </button>
                  <button onClick={() => setPendingAction('reject')} disabled={actionLoading} className="btn-secondary btn-sm text-error-600">
                    <X className="h-4 w-4" />{t('collab.reject')}
                  </button>
                </>
              )}
              {isSender && (
                <button onClick={() => setPendingAction('cancel')} disabled={actionLoading} className="btn-secondary btn-sm text-error-600">
                  <XCircle className="h-4 w-4" />{t('collab.cancel')}
                </button>
              )}
            </div>
          )}

          {/* Order creation (accepted collaboration) */}
          {isAccepted && (
            <div className="flex flex-wrap gap-3 border-t border-slate-100 dark:border-slate-700 pt-4">
              {existingOrder ? (
                <Link to={`/dashboard/orders/${existingOrder.id}`} className="btn-primary btn-sm">
                  <ClipboardList className="h-4 w-4" />{t('order.viewOrder')}
                </Link>
              ) : (
                <button onClick={() => setPendingAction('createOrder')} disabled={orderLoading} className="btn-primary btn-sm">
                  <ClipboardList className="h-4 w-4" />{t('order.createOrder')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <Toast toast={toast} onDismiss={dismissToast} />

      {pendingAction && (
        <ConfirmDialog
          open={!!pendingAction}
          title={t('common.confirmTitle')}
          message={t(actionConfig[pendingAction].messageKey)}
          confirmLabel={t(actionConfig[pendingAction].confirmKey)}
          cancelLabel={t('common.cancel')}
          onConfirm={actionHandlers[pendingAction]}
          onCancel={() => setPendingAction(null)}
          loading={actionLoading || orderLoading}
          destructive={actionConfig[pendingAction].destructive}
        />
      )}
    </UserLayout>
  );
}

function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-slate-400 dark:text-slate-500">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <p className="break-anywhere text-sm font-semibold text-slate-900 dark:text-white">{value}</p>
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
