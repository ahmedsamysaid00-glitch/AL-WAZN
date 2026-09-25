import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { UserLayout } from './UserLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Pagination } from '@/components/ui/Pagination';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useRealtimeNotifications } from '@/hooks/useRealtime';
import { Bell, CheckCheck, Handshake, Check, X, MessageSquare, Trash2, CreditCard, RotateCcw, ShieldCheck, Upload, Wallet, Send, TrendingUp, UserCog } from 'lucide-react';
import type { Notification, NotificationType } from '@/types/database';
import type { TranslationKey } from '@/i18n/translations';

const PAGE_SIZE = 10;

export function UserNotificationsPage() {
  const { t, dir } = useLanguage();
  const { profile } = useAuth();
  const [fetchedNotifications, setFetchedNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const fetchingRef = useRef(false);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const fetchNotifications = useCallback(async (pageNum: number) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setError(false);
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error: err, count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', profile?.id ?? '')
      .order('created_at', { ascending: false })
      .range(from, to);
    if (err) { setError(true); setLoading(false); fetchingRef.current = false; return; }
    setFetchedNotifications((data as Notification[]) ?? []);
    setTotalCount(count ?? 0);
    fetchingRef.current = false;
  }, [profile?.id]);

  const fetchNotificationsInitial = useCallback(async () => {
    setLoading(true);
    await fetchNotifications(0);
    setLoading(false);
  }, [fetchNotifications]);

  useEffect(() => { fetchNotificationsInitial(); }, [fetchNotificationsInitial]);

  const notifications = useRealtimeNotifications(profile?.id, fetchedNotifications);

  const goToPage = (newPage: number) => {
    setPage(newPage);
    fetchNotifications(newPage);
  };

  const handleMarkRead = async (notifId: string) => {
    setActionLoading(true);
    setActionError(null);
    const { error: err } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notifId);
    setActionLoading(false);
    if (err) { setActionError(t('notifications.markReadFailed')); return; }
    setFetchedNotifications((prev) => prev.map((n) => n.id === notifId ? { ...n, is_read: true } : n));
  };

  const handleMarkAllRead = async () => {
    if (!profile?.id) return;
    setActionLoading(true);
    setActionError(null);
    const { error: err } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', profile.id)
      .eq('is_read', false);
    setActionLoading(false);
    if (err) { setActionError(t('notifications.markAllReadFailed')); return; }
    setFetchedNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const handleDelete = async (notifId: string) => {
    setPendingDeleteId(null);
    setDeleteLoading(notifId);
    setActionError(null);
    const { error: err } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notifId);
    setDeleteLoading(null);
    if (err) { setActionError(t('notifications.deleteFailed')); return; }
    setFetchedNotifications((prev) => prev.filter((n) => n.id !== notifId));
  };

  const getNotifLink = (notif: Notification): string | null => {
    if (notif.related_conversation_id) return `/dashboard/messages/${notif.related_conversation_id}`;
    if (notif.related_collaboration_id) return `/dashboard/collaborations/${notif.related_collaboration_id}`;
    if (notif.related_order_id) return `/dashboard/orders/${notif.related_order_id}`;
    if (notif.type === 'feedback_status_changed') return '/dashboard/feedback/my';
    if (notif.type === 'request_approved' || notif.type === 'request_rejected') return '/dashboard/settings';
    return null;
  };

  if (loading) return (
    <UserLayout>
      <div className="max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('notifications.title')}</h1>
        <div className="card"><LoadingState label={t('notifications.loading')} /></div>
      </div>
    </UserLayout>
  );

  if (error) return (
    <UserLayout>
      <div className="max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('notifications.title')}</h1>
        <div className="card"><ErrorState message={t('notifications.failed')} onRetry={() => goToPage(page)} retryLabel={t('common.retry')} /></div>
      </div>
    </UserLayout>
  );

  const hasUnread = notifications.some((n) => !n.is_read);

  return (
    <UserLayout>
      <div className="max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('notifications.title')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('notifications.subtitle')}</p>
          </div>
          {hasUnread && (
            <button onClick={handleMarkAllRead} disabled={actionLoading} className="btn-secondary btn-sm">
              <CheckCheck className="h-4 w-4" />
              {t('notifications.markAllRead')}
            </button>
          )}
        </div>

        {actionError && (
          <div className="rounded-lg bg-error-50 dark:bg-error-900/20 px-3 py-2 text-xs text-error-700 dark:text-error-400">
            {actionError}
          </div>
        )}

        {notifications.length === 0 ? (
          <div className="card"><EmptyState icon={<Bell className="h-8 w-8" />} title={t('notifications.empty')} /></div>
        ) : (
          <div className="space-y-2">
            {notifications.map((notif) => (
              <NotificationRow
                key={notif.id}
                notif={notif}
                t={t}
                onMarkRead={() => handleMarkRead(notif.id)}
                onDelete={() => setPendingDeleteId(notif.id)}
                actionLoading={actionLoading}
                deleteLoading={deleteLoading === notif.id}
                link={getNotifLink(notif)}
              />
            ))}
          </div>
        )}

        <Pagination page={page} totalPages={totalPages} onPageChange={goToPage} t={t} rtl={dir === 'rtl'} />
      </div>

      {pendingDeleteId && (
        <ConfirmDialog
          open={!!pendingDeleteId}
          title={t('common.confirmTitle')}
          message={t('notifications.deleteConfirm')}
          confirmLabel={t('notifications.delete')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => handleDelete(pendingDeleteId)}
          onCancel={() => setPendingDeleteId(null)}
          loading={deleteLoading === pendingDeleteId}
          destructive
        />
      )}
    </UserLayout>
  );
}

function NotificationRow({
  notif, t, onMarkRead, onDelete, actionLoading, deleteLoading, link,
}: {
  notif: Notification;
  t: (k: TranslationKey) => string;
  onMarkRead: () => void;
  onDelete: () => void;
  actionLoading: boolean;
  deleteLoading: boolean;
  link: string | null;
}) {
  const typeConfig: Record<NotificationType, { icon: React.ReactNode; color: string }> = {
    collaboration_request: { icon: <Handshake className="h-5 w-5" />, color: 'bg-accent-50 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400' },
    collaboration_accepted: { icon: <Check className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    collaboration_rejected: { icon: <X className="h-5 w-5" />, color: 'bg-error-50 text-error-600' },
    new_message: { icon: <MessageSquare className="h-5 w-5" />, color: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
    order_created: { icon: <Check className="h-5 w-5" />, color: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
    order_confirmed: { icon: <Check className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    shipment_in_transit: { icon: <Check className="h-5 w-5" />, color: 'bg-accent-50 text-accent-600' },
    shipment_delivered: { icon: <Check className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    receipt_confirmed: { icon: <Check className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    order_completed: { icon: <Check className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    order_cancelled: { icon: <X className="h-5 w-5" />, color: 'bg-error-50 text-error-600' },
    payment_pending: { icon: <CreditCard className="h-5 w-5" />, color: 'bg-warning-50 text-warning-600' },
    payment_paid: { icon: <Check className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    payment_failed: { icon: <X className="h-5 w-5" />, color: 'bg-error-50 text-error-600' },
    payment_refund_requested: { icon: <RotateCcw className="h-5 w-5" />, color: 'bg-warning-50 text-warning-600' },
    payment_refunded: { icon: <RotateCcw className="h-5 w-5" />, color: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
    payment_cancelled: { icon: <X className="h-5 w-5" />, color: 'bg-error-50 text-error-600' },
    payment_completed: { icon: <Check className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    payment_refund_rejected: { icon: <X className="h-5 w-5" />, color: 'bg-error-50 text-error-600' },
    payment_held: { icon: <ShieldCheck className="h-5 w-5" />, color: 'bg-accent-50 text-accent-600' },
    payment_released: { icon: <Check className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    order_awaiting_payment: { icon: <CreditCard className="h-5 w-5" />, color: 'bg-warning-50 text-warning-600' },
    payment_receipt_uploaded: { icon: <Upload className="h-5 w-5" />, color: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
    payment_receipt_approved: { icon: <Check className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    payment_receipt_rejected: { icon: <X className="h-5 w-5" />, color: 'bg-error-50 text-error-600' },
    payout_requested: { icon: <Send className="h-5 w-5" />, color: 'bg-accent-50 text-accent-600' },
    payout_approved: { icon: <Check className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    payout_completed: { icon: <Wallet className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    payout_rejected: { icon: <X className="h-5 w-5" />, color: 'bg-error-50 text-error-600' },
    commission_created: { icon: <TrendingUp className="h-5 w-5" />, color: 'bg-accent-50 text-accent-600' },
    commission_approved: { icon: <Check className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    commission_paid: { icon: <Wallet className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    commission_reversed: { icon: <X className="h-5 w-5" />, color: 'bg-error-50 text-error-600' },
    feedback_status_changed: { icon: <MessageSquare className="h-5 w-5" />, color: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
    admin_role_request: { icon: <UserCog className="h-5 w-5" />, color: 'bg-warning-50 text-warning-600' },
    admin_verification_request: { icon: <ShieldCheck className="h-5 w-5" />, color: 'bg-warning-50 text-warning-600' },
    admin_account_deletion_request: { icon: <Trash2 className="h-5 w-5" />, color: 'bg-error-50 text-error-600' },
    request_approved: { icon: <Check className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    request_rejected: { icon: <X className="h-5 w-5" />, color: 'bg-error-50 text-error-600' },
  };

  const config = typeConfig[notif.type] ?? typeConfig.new_message;
  const typeLabelKey: Record<NotificationType, TranslationKey> = {
    collaboration_request: 'notifications.type.collaboration_request',
    collaboration_accepted: 'notifications.type.collaboration_accepted',
    collaboration_rejected: 'notifications.type.collaboration_rejected',
    new_message: 'notifications.type.new_message',
    order_created: 'notifications.type.order_created',
    order_confirmed: 'notifications.type.order_confirmed',
    shipment_in_transit: 'notifications.type.shipment_in_transit',
    shipment_delivered: 'notifications.type.shipment_delivered',
    receipt_confirmed: 'notifications.type.receipt_confirmed',
    order_completed: 'notifications.type.order_completed',
    order_cancelled: 'notifications.type.order_cancelled',
    payment_pending: 'notifications.type.payment_pending',
    payment_paid: 'notifications.type.payment_paid',
    payment_failed: 'notifications.type.payment_failed',
    payment_refund_requested: 'notifications.type.payment_refund_requested',
    payment_refunded: 'notifications.type.payment_refunded',
    payment_cancelled: 'notifications.type.payment_cancelled',
    payment_completed: 'notifications.type.payment_completed',
    payment_refund_rejected: 'notifications.type.payment_refund_rejected',
    payment_held: 'notifications.type.payment_held',
    payment_released: 'notifications.type.payment_released',
    order_awaiting_payment: 'notifications.type.order_awaiting_payment',
    payment_receipt_uploaded: 'notifications.type.payment_receipt_uploaded',
    payment_receipt_approved: 'notifications.type.payment_receipt_approved',
    payment_receipt_rejected: 'notifications.type.payment_receipt_rejected',
    payout_requested: 'notifications.type.payout_requested',
    payout_approved: 'notifications.type.payout_approved',
    payout_completed: 'notifications.type.payout_completed',
    payout_rejected: 'notifications.type.payout_rejected',
    commission_created: 'notifications.type.commission_created',
    commission_approved: 'notifications.type.commission_approved',
    commission_paid: 'notifications.type.commission_paid',
    commission_reversed: 'notifications.type.commission_reversed',
    feedback_status_changed: 'notifications.type.feedback_status_changed',
    admin_role_request: 'notifications.type.admin_role_request',
    admin_verification_request: 'notifications.type.admin_verification_request',
    admin_account_deletion_request: 'notifications.type.admin_account_deletion_request',
    request_approved: 'notifications.type.request_approved',
    request_rejected: 'notifications.type.request_rejected',
  };

  return (
    <div className={`card p-4 animate-fade-in ${!notif.is_read ? 'ring-2 ring-primary-200' : ''}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${config.color}`}>
          {config.icon}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t(typeLabelKey[notif.type])}</span>
            {!notif.is_read && <span className="badge-primary text-xs">{t('notifications.unread')}</span>}
          </div>
          <h3 className="break-anywhere text-sm font-semibold text-slate-900 dark:text-white">
            {notif.type === 'feedback_status_changed' ? t('feedback_notif_title') : notif.title}
          </h3>
          {notif.body && (
            <p className="break-anywhere text-sm text-slate-600 dark:text-slate-400">
              {notif.type === 'feedback_status_changed' ? (t(notif.body as TranslationKey) !== notif.body ? t(notif.body as TranslationKey) : notif.body) : notif.body}
            </p>
          )}
          <p className="text-xs text-slate-400 dark:text-slate-500">{new Date(notif.created_at).toLocaleString()}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          {link && (
            <Link to={link} className="btn-ghost btn-sm" onClick={onMarkRead}>
              {t('notifications.viewDetails')}
            </Link>
          )}
          {!notif.is_read && (
            <button onClick={onMarkRead} disabled={actionLoading} className="btn-secondary btn-sm text-xs">
              <Check className="h-3.5 w-3.5" />
              {t('notifications.markRead')}
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={deleteLoading}
            className="btn-ghost btn-sm text-xs text-error-500 hover:text-error-700 dark:text-error-400 dark:hover:text-error-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('notifications.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
