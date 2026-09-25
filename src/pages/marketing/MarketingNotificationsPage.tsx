import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { MarketingLayout } from './MarketingLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useRealtimeNotifications } from '@/hooks/useRealtime';
import { Bell, CheckCheck, Check, X, Trash2, MessageSquare, DollarSign, Wallet, PackageCheck } from 'lucide-react';
import type { Notification, NotificationType } from '@/types/database';
import type { TranslationKey } from '@/i18n/translations';

const PAGE_SIZE = 20;

const TRAVELER_SENDER_ONLY_TYPES: NotificationType[] = [
  'collaboration_request',
  'collaboration_accepted',
  'collaboration_rejected',
  'order_awaiting_payment',
  'payment_pending',
  'payment_paid',
  'payment_failed',
  'payment_refund_requested',
  'payment_refunded',
  'payment_cancelled',
  'payment_completed',
  'payment_refund_rejected',
  'payment_held',
  'payment_released',
  'payment_receipt_uploaded',
  'payment_receipt_approved',
  'payment_receipt_rejected',
  'shipment_in_transit',
  'shipment_delivered',
  'receipt_confirmed',
];

export function MarketingNotificationsPage() {
  const { t } = useLanguage();
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
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchNotifications = useCallback(async (pageNum: number, isInitial: boolean) => {
    if (isInitial) {
      setError(false);
    }
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const [{ data, error: err }, { count }] = await Promise.all([
      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile?.id ?? '')
        .order('created_at', { ascending: false })
        .range(from, to),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile?.id ?? ''),
    ]);

    if (err) {
      if (isInitial) setError(true);
      return;
    }

    const newRows = (data as Notification[]) ?? [];
    setTotalCount(count ?? 0);

    if (isInitial) {
      setFetchedNotifications(newRows);
    } else {
      setFetchedNotifications((prev) => [...prev, ...newRows]);
    }
  }, [profile?.id]);

  const fetchInitial = useCallback(async () => {
    setLoading(true);
    setPage(0);
    await fetchNotifications(0, true);
    setLoading(false);
  }, [fetchNotifications]);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  const notifications = useRealtimeNotifications(profile?.id, fetchedNotifications);

  const visibleNotifications = notifications.filter(
    (n) => !TRAVELER_SENDER_ONLY_TYPES.includes(n.type),
  );

  const sortedNotifications = [...visibleNotifications].sort((a, b) => {
    if (a.is_read !== b.is_read) return a.is_read ? 1 : -1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const hasMore = fetchedNotifications.length < totalCount;

  const handleLoadMore = async () => {
    setLoadingMore(true);
    const nextPage = page + 1;
    await fetchNotifications(nextPage, false);
    setPage(nextPage);
    setLoadingMore(false);
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
    const visibleUnreadIds = visibleNotifications.filter((n) => !n.is_read).map((n) => n.id);
    if (visibleUnreadIds.length === 0) return;
    setActionLoading(true);
    setActionError(null);
    const { error: err } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .in('id', visibleUnreadIds);
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
    setTotalCount((prev) => Math.max(0, prev - 1));
  };

  if (loading) {
    return (
      <MarketingLayout>
        <div className="max-w-4xl">
          <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('notifications.title')}</h1>
          <div className="card"><LoadingState label={t('notifications.loading')} /></div>
        </div>
      </MarketingLayout>
    );
  }

  if (error) {
    return (
      <MarketingLayout>
        <div className="max-w-4xl">
          <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('notifications.title')}</h1>
          <div className="card">
            <ErrorState message={t('notifications.failed')} onRetry={fetchInitial} retryLabel={t('common.retry')} />
          </div>
        </div>
      </MarketingLayout>
    );
  }

  const hasUnread = visibleNotifications.some((n) => !n.is_read);
  const visibleCount = visibleNotifications.length;

  return (
    <MarketingLayout>
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

        {sortedNotifications.length === 0 ? (
          <div className="card"><EmptyState icon={<Bell className="h-8 w-8" />} title={t('notifications.empty')} /></div>
        ) : (
          <>
            <div className="space-y-2">
              {sortedNotifications.map((notif) => (
                <NotificationRow
                  key={notif.id}
                  notif={notif}
                  t={t}
                  onMarkRead={() => handleMarkRead(notif.id)}
                  onDelete={() => setPendingDeleteId(notif.id)}
                  actionLoading={actionLoading}
                  deleteLoading={deleteLoading === notif.id}
                />
              ))}
            </div>

            {hasMore && (
              <div className="flex justify-center">
                <button onClick={handleLoadMore} disabled={loadingMore} className="btn-secondary btn-sm">
                  {loadingMore ? t('common.loading') : t('notifications.loadMore')}
                </button>
              </div>
            )}

            {visibleCount > 0 && (
              <p className="text-center text-xs text-slate-400 dark:text-slate-500">
                {t('notifications.showing')} {visibleCount} {t('common.of')} {totalCount}
              </p>
            )}
          </>
        )}
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
    </MarketingLayout>
  );
}

function NotificationRow({
  notif, t, onMarkRead, onDelete, actionLoading, deleteLoading,
}: {
  notif: Notification;
  t: (k: TranslationKey) => string;
  onMarkRead: () => void;
  onDelete: () => void;
  actionLoading: boolean;
  deleteLoading: boolean;
}) {
  const typeConfig: Partial<Record<NotificationType, { icon: React.ReactNode; color: string }>> = {
    new_message: { icon: <MessageSquare className="h-5 w-5" />, color: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
    order_created: { icon: <PackageCheck className="h-5 w-5" />, color: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
    order_confirmed: { icon: <Check className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    order_completed: { icon: <Check className="h-5 w-5" />, color: 'bg-success-50 text-success-600' },
    order_cancelled: { icon: <X className="h-5 w-5" />, color: 'bg-error-50 text-error-600' },
    commission_created: { icon: <DollarSign className="h-5 w-5" />, color: 'bg-success-50 dark:bg-success-900/30 text-success-600 dark:text-success-400' },
    commission_approved: { icon: <Check className="h-5 w-5" />, color: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
    commission_paid: { icon: <Wallet className="h-5 w-5" />, color: 'bg-success-50 dark:bg-success-900/30 text-success-600 dark:text-success-400' },
    commission_reversed: { icon: <X className="h-5 w-5" />, color: 'bg-error-50 dark:bg-error-900/30 text-error-600 dark:text-error-400' },
    payout_requested: { icon: <Wallet className="h-5 w-5" />, color: 'bg-warning-50 dark:bg-warning-900/30 text-warning-600 dark:text-warning-400' },
    payout_approved: { icon: <Check className="h-5 w-5" />, color: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
    payout_completed: { icon: <Wallet className="h-5 w-5" />, color: 'bg-success-50 dark:bg-success-900/30 text-success-600 dark:text-success-400' },
    payout_rejected: { icon: <X className="h-5 w-5" />, color: 'bg-error-50 dark:bg-error-900/30 text-error-600 dark:text-error-400' },
  };

  const config = typeConfig[notif.type] ?? { icon: <Bell className="h-5 w-5" />, color: 'bg-slate-100 dark:bg-slate-700 text-slate-500' };

  const typeLabelKey: Partial<Record<NotificationType, TranslationKey>> = {
    new_message: 'notifications.type.new_message',
    order_created: 'notifications.type.order_created',
    order_confirmed: 'notifications.type.order_confirmed',
    order_completed: 'notifications.type.order_completed',
    order_cancelled: 'notifications.type.order_cancelled',
    commission_created: 'notifications.type.commission_created',
    commission_approved: 'notifications.type.commission_approved',
    commission_paid: 'notifications.type.commission_paid',
    commission_reversed: 'notifications.type.commission_reversed',
    payout_requested: 'notifications.type.payout_requested',
    payout_approved: 'notifications.type.payout_approved',
    payout_completed: 'notifications.type.payout_completed',
    payout_rejected: 'notifications.type.payout_rejected',
  };

  const labelKey = typeLabelKey[notif.type] ?? 'notifications.title';

  return (
    <div className={`card p-4 animate-fade-in ${!notif.is_read ? 'ring-2 ring-primary-200' : ''}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${config.color}`}>
          {config.icon}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t(labelKey)}</span>
            {!notif.is_read && <span className="badge-primary text-xs">{t('notifications.unread')}</span>}
          </div>
          <h3 className="break-anywhere text-sm font-semibold text-slate-900 dark:text-white">{notif.title}</h3>
          {notif.body && <p className="break-anywhere text-sm text-slate-600 dark:text-slate-400">{notif.body}</p>}
          <p className="text-xs text-slate-400 dark:text-slate-500">{new Date(notif.created_at).toLocaleString()}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
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
