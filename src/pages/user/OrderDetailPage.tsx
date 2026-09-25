import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { UserLayout } from './UserLayout';
import { LoadingState, EmptyState } from '@/components/ui/States';
import {
  Package, MapPin, Weight, DollarSign, Calendar, Clock,
  CheckCircle2, Truck, PackageCheck, XCircle, CircleDot, Flag,
  QrCode, Camera, Ban, RefreshCw, ShieldCheck, Loader2, AlertCircle,
  CreditCard, Upload, FileText, Phone, X, Wallet, Send, ArrowLeft,
} from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { OrderWithDetails, ShipmentTrackingEvent, OrderStatus, Payment, PaymentReceipt, Payout, PayoutMethodType } from '@/types/database';
import { ShipmentReceiptPhotoCapture } from '@/components/shipment/ShipmentReceiptPhotoCapture';
import { QrScannerModal } from '@/components/shipment/QrScannerModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import QRCode from 'qrcode';
import { usePaymentReceivingNumber } from '@/hooks/usePlatformSettings';

type OrderActionType = 'accept' | 'startTransit' | 'receipt' | 'complete' | 'cancel' | 'revokeQr' | 'regenerateQr' | null;

export function OrderDetailPage() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const { profile } = useAuth();
  const { receivingNumber } = usePaymentReceivingNumber();
  const { id } = useParams();
  const [order, setOrder] = useState<OrderWithDetails | null>(null);
  const [trackingEvents, setTrackingEvents] = useState<ShipmentTrackingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelBox, setShowCancelBox] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [hasReceiptPhoto, setHasReceiptPhoto] = useState(false);
  const [qrActionLoading, setQrActionLoading] = useState(false);
  const [qrToken, setQrToken] = useState<{ is_revoked: boolean; is_used: boolean } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<OrderActionType>(null);

  // Payment + receipt state
  const [payment, setPayment] = useState<Payment | null>(null);
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [payout, setPayout] = useState<Payout | null>(null);
  const [showReceiptUpload, setShowReceiptUpload] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  // Payout form state
  const [showPayoutForm, setShowPayoutForm] = useState(false);
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethodType>('vodafone_cash');
  const [payoutIdentifier, setPayoutIdentifier] = useState('');
  const [bankName, setBankName] = useState('');
  const [submittingPayout, setSubmittingPayout] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const fetchOrder = useCallback(async () => {
    if (!id) { setNotFound(true); setLoading(false); return; }
    setNotFound(false);
    const { data, error: err } = await supabase
      .from('orders')
      .select(`
        *,
        trips(origin, destination, departure_date, arrival_date, profiles(full_name)),
        sender_listings(product_name, weight_kg, origin, destination, profiles(full_name))
      `)
      .eq('id', id)
      .maybeSingle();
    if (err || !data) { setNotFound(true); setLoading(false); return; }
    setOrder(data as OrderWithDetails);

    const [
      eventsRes,
      photoRes,
      tokenDataRes,
      payDataRes,
      receiptDataRes,
      payoutDataRes,
    ] = await Promise.all([
      supabase.from('shipment_tracking_events').select('*').eq('order_id', id).order('created_at', { ascending: true }),
      supabase.from('shipment_receipt_photos').select('id').eq('order_id', id).maybeSingle(),
      supabase.from('delivery_qr_tokens').select('is_revoked, is_used').eq('order_id', id).maybeSingle(),
      supabase.from('payments').select('*').eq('order_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('payment_receipts').select('*').eq('order_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('payouts').select('*').eq('order_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    setTrackingEvents((eventsRes.data as ShipmentTrackingEvent[]) ?? []);
    setHasReceiptPhoto(!!photoRes.data);
    setQrToken(tokenDataRes.data as { is_revoked: boolean; is_used: boolean } | null);
    setPayment(payDataRes.data as Payment | null);
    setReceipt(receiptDataRes.data as PaymentReceipt | null);
    setPayout(payoutDataRes.data as Payout | null);

    setLoading(false);
  }, [id]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);

  // Fetch/generate the delivery QR token via the secure idempotent RPC
  // when the order is in_transit and the viewer is the sender.
  useEffect(() => {
    const currentOrder = orderRef.current;
    const currentProfile = profileRef.current;
    if (!currentOrder || !currentProfile) return;
    const isSender = currentOrder.sender_id === currentProfile.id;
    if (!isSender) { setQrDataUrl(null); setQrLoading(false); return; }

    if (currentOrder.status === 'in_transit' && !qrToken?.is_revoked && !qrToken?.is_used) {
      let cancelled = false;
      setQrLoading(true);
      setQrError(null);
      setQrDataUrl(null);

      (async () => {
        try {
          const { data, error: rpcError } = await supabase.rpc('generate_delivery_qr', { p_order_id: currentOrder.id });
          if (cancelled) return;
          if (rpcError || !data) {
            setQrError(t('shipment.qrGenerationFailed'));
            setQrLoading(false);
            return;
          }

          const row = Array.isArray(data) ? data[0] : data;
          if (!row || !row.token) {
            setQrError(t('shipment.qrGenerationFailed'));
            setQrLoading(false);
            return;
          }

          const verifyUrl = `${window.location.origin}/delivery/verify/${row.token}`;
          try {
            const dataUrl = await QRCode.toDataURL(verifyUrl, {
              width: 256,
              margin: 2,
              color: { dark: '#0f172a', light: '#ffffff' },
            });
            if (cancelled) return;
            setQrDataUrl(dataUrl);
            setQrLoading(false);
          } catch {
            if (cancelled) return;
            setQrError(t('shipment.qrGenerationFailed'));
            setQrLoading(false);
          }
        } catch {
          if (cancelled) return;
          setQrError(t('shipment.qrGenerationFailed'));
          setQrLoading(false);
        }
      })();

      return () => { cancelled = true; };
    }

    setQrDataUrl(null);
    setQrError(null);
    setQrLoading(false);
  }, [order?.id, order?.status, qrToken?.is_revoked, qrToken?.is_used, profile?.id, t]);

  useRealtimeRefresh(
    [
      { table: 'orders', filter: `id=eq.${id ?? ''}` },
      { table: 'shipment_tracking_events', filter: `order_id=eq.${id ?? ''}` },
      { table: 'shipment_receipt_photos', filter: `order_id=eq.${id ?? ''}` },
      { table: 'delivery_qr_tokens', filter: `order_id=eq.${id ?? ''}` },
      { table: 'payments', filter: `order_id=eq.${id ?? ''}` },
      { table: 'payment_receipts', filter: `order_id=eq.${id ?? ''}` },
      { table: 'payouts', filter: `order_id=eq.${id ?? ''}` },
    ],
    () => fetchOrder(),
    !!id,
  );

  const handleRevokeQr = async () => {
    if (!order) return;
    setPendingAction(null);
    setQrActionLoading(true);
    const { error: rpcError } = await supabase.rpc('revoke_delivery_qr', { p_order_id: order.id });
    setQrActionLoading(false);
    if (rpcError) {
      setActionError(t('shipment.qrActionFailed'));
      return;
    }
    setActionSuccess(t('shipment.qrRevokedSuccess'));
    fetchOrder();
  };

  const handleRegenerateQr = async () => {
    if (!order) return;
    setPendingAction(null);
    setQrActionLoading(true);
    const { error: rpcError } = await supabase.rpc('regenerate_delivery_qr', { p_order_id: order.id });
    setQrActionLoading(false);
    if (rpcError) {
      setActionError(t('shipment.qrActionFailed'));
      return;
    }
    setActionSuccess(t('shipment.qrRegeneratedSuccess'));
    fetchOrder();
  };

  const handleAction = async (newStatus: OrderStatus, needsReason = false) => {
    if (!order) return;
    if (needsReason && !cancelReason.trim()) {
      setActionError(t('order.action.cancelFailed'));
      return;
    }
    setPendingAction(null);
    setActionLoading(true);
    const updateData: Record<string, string | null> = { status: newStatus };
    if (newStatus === 'cancelled' && cancelReason.trim()) {
      updateData.cancellation_reason = cancelReason.trim();
    }
    const { error: err } = await supabase.from('orders').update(updateData).eq('id', order.id);
    setActionLoading(false);
    setShowCancelBox(false);
    setCancelReason('');
    if (err) {
      setActionError(t('order.action.failed'));
      return;
    }
    fetchOrder();
  };

  const handleAcceptOrder = async () => {
    if (!order) return;
    setPendingAction(null);
    setActionLoading(true);
    const { error: rpcError } = await supabase.rpc('accept_order', { p_order_id: order.id });
    setActionLoading(false);
    if (rpcError) {
      setActionError(t('order.action.acceptFailed'));
      return;
    }
    setActionSuccess(t('order.action.acceptSuccess'));
    fetchOrder();
  };

  const actionHandlers: Record<string, () => void> = {
    accept: handleAcceptOrder,
    startTransit: () => handleAction('in_transit'),
    receipt: () => handleAction('received'),
    complete: () => handleAction('completed'),
    cancel: () => handleAction('cancelled', true),
    revokeQr: handleRevokeQr,
    regenerateQr: handleRegenerateQr,
  };

  const actionConfig: Record<string, { messageKey: TranslationKey; confirmKey: TranslationKey; destructive: boolean }> = {
    accept: { messageKey: 'order.action.acceptConfirm', confirmKey: 'order.action.accept', destructive: false },
    startTransit: { messageKey: 'order.action.startTransitConfirm', confirmKey: 'order.action.startTransit', destructive: false },
    receipt: { messageKey: 'order.action.receiptConfirm', confirmKey: 'order.action.confirmReceipt', destructive: false },
    complete: { messageKey: 'order.action.completeConfirm', confirmKey: 'order.action.complete', destructive: false },
    cancel: { messageKey: 'order.action.cancelConfirm', confirmKey: 'order.action.cancel', destructive: true },
    revokeQr: { messageKey: 'shipment.revokeQrConfirm', confirmKey: 'shipment.revokeQr', destructive: true },
    regenerateQr: { messageKey: 'shipment.regenerateQrConfirm', confirmKey: 'shipment.regenerateQr', destructive: false },
  };

  const handleInitiatePayment = async () => {
    if (!order) return;
    setActionLoading(true);
    const { error: rpcError } = await supabase.rpc('initiate_payment', {
      p_order_id: order.id,
      p_payment_method: 'manual',
    });
    setActionLoading(false);
    if (rpcError) {
      setActionError(t('order.action.paymentInitFailed'));
      return;
    }
    fetchOrder();
    setShowReceiptUpload(true);
  };

  const handleUploadReceipt = async () => {
    if (!order || !payment || !receiptFile || !profile) return;
    setUploadingReceipt(true);

    try {
      const fileExt = receiptFile.name.split('.').pop()?.toLowerCase() ?? '';
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${profile.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('payment-receipts')
        .upload(filePath, receiptFile, {
          contentType: receiptFile.type,
          upsert: false,
        });

      if (uploadError) {
        setActionError(t('order.action.receiptUploadFailed'));
        setUploadingReceipt(false);
        return;
      }

      const { error: insertError } = await supabase
        .from('payment_receipts')
        .insert({
          payment_id: payment.id,
          order_id: order.id,
          uploader_id: profile.id,
          storage_path: filePath,
          file_name: receiptFile.name,
          file_type: receiptFile.type,
          file_size: receiptFile.size,
          status: 'pending_verification',
        });

      if (insertError) {
        setActionError(t('order.action.receiptUploadFailed'));
        setUploadingReceipt(false);
        return;
      }

      setUploadingReceipt(false);
      setShowReceiptUpload(false);
      setReceiptFile(null);
      setActionSuccess(t('order.action.receiptUploaded'));
      fetchOrder();
    } catch {
      setUploadingReceipt(false);
      setActionError(t('order.action.receiptUploadFailed'));
    }
  };

  const handleSubmitPayout = async () => {
    if (!order || !profile || !payoutIdentifier.trim()) return;
    if (payoutMethod === 'bank_transfer' && !bankName.trim()) return;

    setSubmittingPayout(true);

    const payoutDetails: Record<string, string> = { identifier: payoutIdentifier.trim() };
    if (payoutMethod === 'bank_transfer') {
      payoutDetails.bank_name = bankName.trim();
    }

    const { error: rpcError } = await supabase.rpc('submit_payout', {
      p_order_id: order.id,
      p_payout_method: payoutMethod,
      p_payout_identifier: payoutIdentifier.trim(),
      p_payout_details: payoutDetails,
    });

    setSubmittingPayout(false);

    if (rpcError) {
      setActionError(t('order.action.payoutSubmitFailed'));
      return;
    }

    setShowPayoutForm(false);
    setPayoutIdentifier('');
    setBankName('');
    setActionSuccess(t('order.action.payoutSubmitted'));
    fetchOrder();
  };

  if (loading) return (
    <UserLayout><div className="max-w-3xl"><div className="flex justify-center py-12"><LoadingState /></div></div></UserLayout>
  );

  if (notFound || !order) return (
    <UserLayout>
      <div className="max-w-3xl">
        <div className="card p-8 text-center">
          <p className="text-slate-600 dark:text-slate-400">{t('orders.notFound')}</p>
          <Link to="/dashboard/orders" className="btn-secondary btn-sm mt-4">{t('orders.backToOrders')}</Link>
        </div>
      </div>
    </UserLayout>
  );

  const trip = order.trips;
  const listing = order.sender_listings;
  const isTraveler = order.traveler_id === profile?.id;
  const isSender = order.sender_id === profile?.id;
  const isAdmin = profile?.role === 'admin';
  const status = order.status;

  const paymentStatus = payment?.status;
  const receiptStatus = receipt?.status;
  const payoutStatus = payout?.status;

  return (
    <UserLayout>
      <div className="max-w-3xl space-y-6">
        <Link to="/dashboard/orders" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className={`h-4 w-4 ${arrow}`} />
          {t('orders.backToOrders')}
        </Link>

        {/* Order header */}
        <div className="card p-6 space-y-6">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="break-anywhere text-2xl font-bold text-slate-900 dark:text-white">{order.order_number}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('orders.orderInfo')}</p>
            </div>
            <StatusBadge status={status} t={t} />
          </div>

          {/* Route + product */}
          <div className="grid gap-4 sm:grid-cols-2">
            {trip && (
              <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">{t('orders.route')}</h3>
                <InfoItem icon={<MapPin />} label={t('orders.route')} value={`${trip.origin} ${arrow === 'rotate-180' ? '←' : '→'} ${trip.destination}`} />
                <InfoItem icon={<Calendar />} label={t('trip.detailSchedule')} value={`${trip.departure_date} → ${trip.arrival_date}`} />
                <InfoItem icon={<MapPin />} label={t('orders.pickupLocation')} value={order.pickup_location ?? trip.origin} />
                <InfoItem icon={<MapPin />} label={t('orders.deliveryLocation')} value={order.delivery_location ?? trip.destination} />
              </div>
            )}
            {listing && (
              <div className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">{t('orders.product')}</h3>
                <InfoItem icon={<Package />} label={t('orders.product')} value={listing.product_name} />
                <InfoItem icon={<Weight />} label={t('orders.weight')} value={`${order.agreed_weight_kg} kg`} />
                <InfoItem icon={<DollarSign />} label={t('orders.price')} value={String(order.agreed_price)} />
                <InfoItem icon={<DollarSign />} label={t('orders.totalAmount')} value={`${order.total_amount} ${order.currency}`} />
              </div>
            )}
          </div>

          {/* Participants */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-100 dark:border-slate-700 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('orders.traveler')}</p>
              <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{trip?.profiles?.full_name ?? '—'}</p>
            </div>
            <div className="rounded-lg border border-slate-100 dark:border-slate-700 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('orders.sender')}</p>
              <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{listing?.profiles?.full_name ?? '—'}</p>
            </div>
          </div>

          {/* Expected delivery + timestamps */}
          <div className="grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2">
            {order.expected_delivery_date && <span>{t('orders.expectedDelivery')}: {order.expected_delivery_date}</span>}
            <span>{t('orders.createdAt')}: {new Date(order.created_at).toLocaleString()}</span>
            {order.traveler_confirmed_at && <span>{t('orders.confirmedAt')}: {new Date(order.traveler_confirmed_at).toLocaleString()}</span>}
            {order.delivered_at && <span>{t('orders.deliveredAt')}: {new Date(order.delivered_at).toLocaleString()}</span>}
            {order.received_at && <span>{t('orders.receivedAt')}: {new Date(order.received_at).toLocaleString()}</span>}
            {order.completed_at && <span>{t('orders.completedAt')}: {new Date(order.completed_at).toLocaleString()}</span>}
            {order.cancelled_at && <span>{t('orders.cancelledAt')}: {new Date(order.cancelled_at).toLocaleString()}</span>}
          </div>

          {order.cancellation_reason && (
            <div className="rounded-lg border border-error-200 bg-error-50 p-3">
              <p className="text-xs font-medium text-error-700">{t('orders.cancellationReason')}</p>
              <p className="mt-1 text-sm text-error-600">{order.cancellation_reason}</p>
            </div>
          )}

          {/* Action feedback */}
          {actionError && (
            <div className="alert-error">{actionError}</div>
          )}
          {actionSuccess && (
            <div className="alert-success">{actionSuccess}</div>
          )}

          {/* Actions */}
          {showCancelBox && (
            <div className="rounded-lg border border-error-200 bg-error-50 p-4 space-y-3">
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={t('order.action.cancelReasonPlaceholder')}
                className="input"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction('cancelled', true)}
                  disabled={actionLoading}
                  className="btn-primary btn-sm bg-error-600 hover:bg-error-700"
                >
                  {t('order.action.cancel')}
                </button>
                <button onClick={() => { setShowCancelBox(false); setCancelReason(''); }} className="btn-secondary btn-sm">
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}

          {/* ===== MANUAL PAYMENT SECTION (Sender) ===== */}

          {/* Payment required: show receiving number + upload receipt */}
          {isSender && status === 'awaiting_payment' && (
            <div className="rounded-lg border border-warning-200 bg-warning-50 p-5 space-y-4">
              <div className="flex items-start gap-3">
                <CreditCard className="h-5 w-5 text-warning-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-warning-800">{t('order.action.paymentRequiredTitle')}</p>
                  <p className="text-sm text-warning-700">{t('order.action.paymentRequiredDescription')}</p>
                </div>
              </div>

              <div className="rounded-lg bg-white dark:bg-slate-800 border border-warning-200 dark:border-warning-700 p-4 space-y-3">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('order.action.amountToTransfer')}</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{order.total_amount} {order.currency}</p>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-primary-50 dark:bg-primary-900/20 p-3">
                  <Phone className="h-5 w-5 text-primary-600 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-primary-600 dark:text-primary-400">{t('order.action.transferTo')}</p>
                    <p className="text-lg font-bold tracking-wider text-primary-900 dark:text-primary-100" dir="ltr">{receivingNumber}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('order.action.transferInstructions')}</p>
              </div>

              {/* Receipt status display */}
              {receiptStatus === 'pending_verification' && (
                <div className="rounded-lg border border-primary-200 bg-primary-50 p-3 flex items-start gap-2">
                  <Loader2 className="h-4 w-4 text-primary-600 shrink-0 mt-0.5 animate-spin" />
                  <p className="text-sm text-primary-700">{t('order.action.receiptPendingVerification')}</p>
                </div>
              )}
              {receiptStatus === 'approved' && (
                <div className="rounded-lg border border-success-200 bg-success-50 p-3 flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-success-700">{t('order.action.receiptApproved')}</p>
                </div>
              )}
              {receiptStatus === 'rejected' && (
                <div className="rounded-lg border border-error-200 bg-error-50 p-3 space-y-1">
                  <div className="flex items-start gap-2">
                    <XCircle className="h-4 w-4 text-error-600 shrink-0 mt-0.5" />
                    <p className="text-sm font-semibold text-error-700">{t('order.action.receiptRejected')}</p>
                  </div>
                  {receipt?.rejection_reason && (
                    <p className="text-sm text-error-600 pl-6">{receipt.rejection_reason}</p>
                  )}
                  <p className="text-sm text-error-600 pl-6">{t('order.action.uploadNewReceipt')}</p>
                </div>
              )}

              {/* Upload receipt button */}
              {(!receiptStatus || receiptStatus === 'rejected') && (
                <button
                  onClick={() => {
                    if (!payment) {
                      handleInitiatePayment();
                    } else {
                      setShowReceiptUpload(true);
                    }
                  }}
                  disabled={actionLoading}
                  className="btn-primary w-full"
                >
                  <Upload className="h-4 w-4" /> {t('order.action.uploadReceipt')}
                </button>
              )}
            </div>
          )}

          {/* Payment held banner (sender) */}
          {isSender && paymentStatus === 'held' && status === 'confirmed' && (
            <div className="rounded-lg border border-success-200 bg-success-50 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-success-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-success-800">{t('order.action.paymentHeldTitle')}</p>
                  <p className="text-sm text-success-700">{t('order.action.paymentHeldDescription')}</p>
                </div>
              </div>
            </div>
          )}

          {/* Traveler: payment secured banner */}
          {isTraveler && paymentStatus === 'held' && status === 'confirmed' && (
            <div className="rounded-lg border border-accent-200 bg-accent-50 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-accent-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-accent-800">{t('order.action.paymentSecuredTitle')}</p>
                  <p className="text-sm text-accent-700">{t('order.action.paymentSecuredDescription')}</p>
                </div>
              </div>
            </div>
          )}

          {/* ===== PAYOUT SECTION (Traveler) ===== */}

          {/* Traveler: payout form after delivery */}
          {isTraveler && (status === 'delivered' || status === 'received' || status === 'completed') && !payout && (
            <div className="rounded-lg border border-primary-200 bg-primary-50 p-5 space-y-3">
              <div className="flex items-start gap-3">
                <Wallet className="h-5 w-5 text-primary-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-primary-800">{t('order.action.receivePaymentTitle')}</p>
                  <p className="text-sm text-primary-700">{t('order.action.receivePaymentDescription')}</p>
                </div>
              </div>
              <button onClick={() => setShowPayoutForm(true)} className="btn-primary w-full">
                <Send className="h-4 w-4" /> {t('order.action.submitPayout')}
              </button>
            </div>
          )}

          {/* Payout status display (traveler) */}
          {isTraveler && payout && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('order.action.payoutStatus')}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-slate-500">{t('order.action.payoutMethod')}</p>
                  <p className="font-medium text-slate-700 dark:text-slate-300">{t(`order.action.payoutMethodType.${payout.payout_method}` as TranslationKey)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">{t('order.action.netAmount')}</p>
                  <p className="font-medium text-slate-700 dark:text-slate-300">{payout.net_amount} {payout.currency}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">{t('order.action.platformFee')}</p>
                  <p className="font-medium text-slate-700 dark:text-slate-300">{payout.platform_fee} {payout.currency}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">{t('order.action.payoutStatusLabel')}</p>
                  <span className={
                    payoutStatus === 'completed' ? 'badge-success' :
                    payoutStatus === 'approved' || payoutStatus === 'processing' ? 'badge-primary' :
                    payoutStatus === 'rejected' ? 'badge-error' : 'badge-warning'
                  }>{t(`order.action.payoutStatusValue.${payoutStatus}` as TranslationKey)}</span>
                </div>
              </div>
              {payout.rejection_reason && (
                <p className="text-sm text-error-600">{payout.rejection_reason}</p>
              )}
            </div>
          )}

          {/* Action buttons */}
          {!showCancelBox && status !== 'completed' && status !== 'cancelled' && (
            <div className="flex flex-wrap gap-3 border-t border-slate-100 dark:border-slate-700 pt-4">
              {isTraveler && status === 'pending' && (
                <button onClick={() => setPendingAction('accept')} disabled={actionLoading} className="btn-primary btn-sm">
                  <CheckCircle2 className="h-4 w-4" />{t('order.action.accept')}
                </button>
              )}
              {isTraveler && status === 'confirmed' && (
                <button onClick={() => setPendingAction('startTransit')} disabled={actionLoading || !hasReceiptPhoto} className="btn-primary btn-sm">
                  <Truck className="h-4 w-4" />{t('order.action.startTransit')}
                </button>
              )}
              {isTraveler && status === 'in_transit' && (
                <button onClick={() => setShowQrScanner(true)} disabled={actionLoading} className="btn-primary btn-sm">
                  <QrCode className="h-4 w-4" />{t('shipment.scanRecipientQr')}
                </button>
              )}
              {isSender && status === 'delivered' && (
                <button onClick={() => setPendingAction('receipt')} disabled={actionLoading} className="btn-primary btn-sm">
                  <PackageCheck className="h-4 w-4" />{t('order.action.confirmReceipt')}
                </button>
              )}
              {(isSender || isTraveler) && status === 'received' && (
                <button onClick={() => setPendingAction('complete')} disabled={actionLoading} className="btn-primary btn-sm">
                  <Flag className="h-4 w-4" />{t('order.action.complete')}
                </button>
              )}
              {(isSender || isTraveler) && (status === 'pending' || status === 'awaiting_payment' || status === 'confirmed' || status === 'in_transit') && (
                <button onClick={() => setShowCancelBox(true)} disabled={actionLoading} className="btn-secondary btn-sm text-error-600">
                  <XCircle className="h-4 w-4" />{t('order.action.cancel')}
                </button>
              )}
            </div>
          )}

          {/* Admin-only QR management */}
          {isAdmin && (status === 'confirmed' || status === 'in_transit') && qrToken && !qrToken.is_revoked && !qrToken.is_used && (
            <div className="flex flex-wrap gap-3 border-t border-slate-100 dark:border-slate-700 pt-4">
              <button onClick={() => setPendingAction('revokeQr')} disabled={qrActionLoading} className="btn-secondary btn-sm text-error-600">
                <Ban className="h-4 w-4" />{t('shipment.revokeQr')}
              </button>
              <button onClick={() => setPendingAction('regenerateQr')} disabled={qrActionLoading} className="btn-secondary btn-sm">
                <RefreshCw className="h-4 w-4" />{t('shipment.regenerateQr')}
              </button>
            </div>
          )}

          {isAdmin && qrToken?.is_revoked && (
            <div className="flex flex-wrap gap-3 border-t border-slate-100 dark:border-slate-700 pt-4">
              <button onClick={() => setPendingAction('regenerateQr')} disabled={qrActionLoading} className="btn-secondary btn-sm">
                <RefreshCw className="h-4 w-4" />{t('shipment.regenerateQr')}
              </button>
            </div>
          )}
        </div>

        {/* Shipment receipt photo section */}
        {isTraveler && status === 'confirmed' && !hasReceiptPhoto && (
          <div className="card p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary-600" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('shipment.shipmentReceived')}</h2>
            </div>
            <ShipmentReceiptPhotoCapture
              orderId={order.id}
              onPhotoRecorded={() => { setHasReceiptPhoto(true); fetchOrder(); }}
            />
          </div>
        )}

        {hasReceiptPhoto && status === 'confirmed' && (
          <div className="card p-6">
            <div className="flex items-center gap-2 text-success-600 dark:text-success-400">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold">{t('shipment.receivedConfirmed')}</span>
            </div>
          </div>
        )}

        {/* Sender Delivery QR section */}
        {isSender && status === 'in_transit' && (
          <div className="card p-6 space-y-4">
            <div className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary-600" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('shipment.deliveryQrTitle')}</h2>
            </div>

            {qrLoading && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('shipment.deliveryQrPreparing')}</p>
              </div>
            )}

            {!qrLoading && qrError && (
              <div className="rounded-lg border border-error-200 bg-error-50 dark:bg-error-900/20 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-error-500" />
                  <p className="text-sm text-error-600 dark:text-error-400">{qrError}</p>
                </div>
                <button onClick={() => fetchOrder()} className="btn-secondary btn-sm">
                  <RefreshCw className="h-4 w-4" />{t('common.retry')}
                </button>
              </div>
            )}

            {!qrLoading && !qrError && qrToken?.is_revoked && (
              <div className="rounded-lg border border-error-200 bg-error-50 dark:bg-error-900/20 p-4">
                <div className="flex items-center gap-2">
                  <Ban className="h-5 w-5 text-error-500" />
                  <p className="text-sm font-semibold text-error-600 dark:text-error-400">{t('shipment.qrRevokedState')}</p>
                </div>
                <p className="mt-1 text-sm text-error-500 dark:text-error-400">{t('shipment.qrRevokedMessage')}</p>
              </div>
            )}

            {!qrLoading && !qrError && qrToken?.is_used && (
              <div className="rounded-lg border border-success-200 bg-success-50 dark:bg-success-900/20 p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-success-500" />
                  <p className="text-sm font-semibold text-success-600 dark:text-success-400">{t('shipment.deliveryVerified')}</p>
                </div>
              </div>
            )}

            {!qrLoading && !qrError && !qrToken?.is_revoked && !qrToken?.is_used && qrDataUrl && (
              <div className="space-y-4">
                <div className="flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white p-4">
                  <img src={qrDataUrl} alt={t('shipment.deliveryQrTitle')} className="h-64 w-64" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="badge-success">{t('shipment.deliveryQrActive')}</span>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('shipment.deliveryQrInstructions')}</p>
              </div>
            )}
          </div>
        )}

        {isSender && (status === 'delivered' || status === 'received' || status === 'completed') && (
          <div className="card p-6">
            <div className="flex items-center gap-2 text-success-600 dark:text-success-400">
              <ShieldCheck className="h-5 w-5" />
              <span className="font-semibold">{t('shipment.deliveryVerified')}</span>
            </div>
          </div>
        )}

        {/* Tracking timeline */}
        <div className="card p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{t('orders.trackingTimeline')}</h2>
          {trackingEvents.length === 0 ? (
            <EmptyState icon={<Clock className="h-8 w-8" />} title={t('orders.noTrackingEvents')} />
          ) : (
            <div className="space-y-0">
              {trackingEvents.map((event, idx) => {
                const isLast = idx === trackingEvents.length - 1;
                const Icon = trackingIcon(event.status);
                return (
                  <div key={event.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                        isLast ? 'bg-primary-100 text-primary-600 dark:text-primary-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
                      }`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      {!isLast && <div className="h-full w-px bg-slate-200 dark:bg-slate-700" />}
                    </div>
                    <div className="min-w-0 flex-1 pb-6">
                      <p className={`text-sm font-semibold ${isLast ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'}`}>{event.title}</p>
                      {event.description && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{event.description}</p>}
                      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{new Date(event.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* QR Scanner Modal */}
      {showQrScanner && order && (
        <QrScannerModal
          orderId={order.id}
          onVerified={() => { setShowQrScanner(false); fetchOrder(); }}
          onClose={() => setShowQrScanner(false)}
        />
      )}

      {/* Receipt Upload Modal */}
      {showReceiptUpload && order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !uploadingReceipt && setShowReceiptUpload(false)}>
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 p-4">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('order.action.uploadReceiptTitle')}</h2>
              <button onClick={() => !uploadingReceipt && setShowReceiptUpload(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="rounded-lg bg-primary-50 dark:bg-primary-900/20 p-3 space-y-1">
                <p className="text-xs font-medium text-primary-600 dark:text-primary-400">{t('order.action.transferTo')}</p>
                <p className="text-lg font-bold tracking-wider text-primary-900 dark:text-primary-100" dir="ltr">{receivingNumber}</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{order.total_amount} {order.currency}</p>
              </div>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/jpg,application/pdf"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 p-6 text-center hover:border-primary-400 transition-colors"
                >
                  {receiptFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileText className="h-5 w-5 text-primary-600" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{receiptFile.name}</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload className="h-8 w-8 text-slate-400 mx-auto" />
                      <p className="text-sm text-slate-500 dark:text-slate-400">{t('order.action.selectReceiptFile')}</p>
                      <p className="text-xs text-slate-400">JPG, PNG, PDF</p>
                    </div>
                  )}
                </button>
              </div>

              <button
                onClick={handleUploadReceipt}
                disabled={!receiptFile || uploadingReceipt}
                className="btn-primary w-full"
              >
                {uploadingReceipt ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {t('order.action.uploading')}</>
                ) : (
                  <><Upload className="h-4 w-4" /> {t('order.action.uploadReceipt')}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingAction && (
        <ConfirmDialog
          open={!!pendingAction}
          title={t('common.confirmTitle')}
          message={t(actionConfig[pendingAction].messageKey)}
          confirmLabel={t(actionConfig[pendingAction].confirmKey)}
          cancelLabel={t('common.cancel')}
          onConfirm={actionHandlers[pendingAction]}
          onCancel={() => setPendingAction(null)}
          loading={actionLoading || qrActionLoading}
          destructive={actionConfig[pendingAction].destructive}
        />
      )}

      {/* Payout Form Modal */}
      {showPayoutForm && order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !submittingPayout && setShowPayoutForm(false)}>
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 p-4">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('order.action.payoutFormTitle')}</h2>
              <button onClick={() => !submittingPayout && setShowPayoutForm(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-slate-500">{t('order.action.grossAmount')}</p>
                  <p className="font-semibold text-slate-700 dark:text-slate-300">{order.total_amount} {order.currency}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">{t('order.action.platformFee')}</p>
                  <p className="font-semibold text-slate-700 dark:text-slate-300">{order.platform_fee} {order.currency}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">{t('order.action.netAmount')}</p>
                  <p className="font-semibold text-success-600">{order.agreed_price} {order.currency}</p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('order.action.selectPayoutMethod')}</label>
                <select
                  value={payoutMethod}
                  onChange={(e) => setPayoutMethod(e.target.value as PayoutMethodType)}
                  className="input mt-1"
                >
                  <option value="vodafone_cash">{t('order.action.payoutMethodType.vodafone_cash')}</option>
                  <option value="orange_cash">{t('order.action.payoutMethodType.orange_cash')}</option>
                  <option value="etisalat_cash">{t('order.action.payoutMethodType.etisalat_cash')}</option>
                  <option value="we_pay">{t('order.action.payoutMethodType.we_pay')}</option>
                  <option value="instapay">{t('order.action.payoutMethodType.instapay')}</option>
                  <option value="bank_transfer">{t('order.action.payoutMethodType.bank_transfer')}</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {payoutMethod === 'bank_transfer' ? t('order.action.accountNumber') : t('order.action.phoneNumber')}
                </label>
                <input
                  type="text"
                  value={payoutIdentifier}
                  onChange={(e) => setPayoutIdentifier(e.target.value)}
                  placeholder={payoutMethod === 'bank_transfer' ? t('order.action.accountNumberPlaceholder') : '01XXXXXXXXX'}
                  className="input mt-1"
                  dir="ltr"
                />
              </div>

              {payoutMethod === 'bank_transfer' && (
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('order.action.bankName')}</label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder={t('order.action.bankNamePlaceholder')}
                    className="input mt-1"
                  />
                </div>
              )}

              <button
                onClick={handleSubmitPayout}
                disabled={!payoutIdentifier.trim() || (payoutMethod === 'bank_transfer' && !bankName.trim()) || submittingPayout}
                className="btn-primary w-full"
              >
                {submittingPayout ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {t('order.action.submitting')}</>
                ) : (
                  <><Send className="h-4 w-4" /> {t('order.action.submitPayout')}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </UserLayout>
  );
}

function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 mb-2">
      <span className="mt-0.5 text-slate-400 dark:text-slate-500">{icon}</span>
      <div>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-sm font-semibold text-slate-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}

function trackingIcon(status: string) {
  const map: Record<string, React.ComponentType<{ className?: string }>> = {
    order_created: CircleDot,
    order_confirmed: CheckCircle2,
    shipment_picked_up: Package,
    shipment_in_transit: Truck,
    shipment_delivered: PackageCheck,
    receipt_confirmed: PackageCheck,
    order_completed: Flag,
    order_cancelled: XCircle,
  };
  return map[status] ?? CircleDot;
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
