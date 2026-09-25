import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';

import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { AdminLayout } from './AdminLayout';
import { LoadingState, ErrorState, EmptyState, Spinner } from '@/components/ui/States';
import {
  Bell,
  Search,
  ChevronLeft,
  ChevronRight,
  Check,
  CheckCheck,
  ShieldCheck,
  UserCog,
  Trash2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import type { Notification, NotificationType } from '@/types/database';
import type { TranslationKey } from '@/i18n/translations';

interface AdminNotification extends Notification {
  user_profile?: { full_name: string | null; email: string | null };
  request_status?: 'pending' | 'approved' | 'rejected';
}

type CategoryFilter = 'all' | 'unread' | 'action_required' | 'verification' | 'role_requests' | 'other_requests';

const ADMIN_ACTION_TYPES: NotificationType[] = [
  'admin_role_request',
  'admin_verification_request',
  'admin_account_deletion_request',
];

const PAGE_SIZE = 20;

const TYPE_KEY_MAP: Record<NotificationType, TranslationKey> = {
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
  order_awaiting_payment: 'notifications.type.order_awaiting_payment',
  payment_pending: 'notifications.type.payment_pending',
  payment_paid: 'notifications.type.payment_paid',
  payment_failed: 'notifications.type.payment_failed',
  payment_held: 'notifications.type.payment_held',
  payment_released: 'notifications.type.payment_released',
  payment_refund_requested: 'notifications.type.payment_refund_requested',
  payment_refunded: 'notifications.type.payment_refunded',
  payment_cancelled: 'notifications.type.payment_cancelled',
  payment_completed: 'notifications.type.payment_completed',
  payment_refund_rejected: 'notifications.type.payment_refund_rejected',
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

function isAdminAction(type: NotificationType): boolean {
  return ADMIN_ACTION_TYPES.includes(type);
}

function getActionIcon(type: NotificationType) {
  if (type === 'admin_verification_request') return <ShieldCheck className="h-4 w-4" />;
  if (type === 'admin_account_deletion_request') return <Trash2 className="h-4 w-4" />;
  return <UserCog className="h-4 w-4" />;
}

export function AdminNotifications() {
  const { t, dir } = useLanguage();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [actionRequiredCount, setActionRequiredCount] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(false);

    let query = supabase.from('notifications').select('*', { count: 'exact' });

    if (search.trim()) {
      query = query.or(`title.ilike.%${search.trim()}%,body.ilike.%${search.trim()}%`);
    }

    if (category === 'unread') {
      query = query.eq('is_read', false).in('type', ADMIN_ACTION_TYPES);
    } else if (category === 'action_required') {
      query = query.in('type', ADMIN_ACTION_TYPES);
    } else if (category === 'verification') {
      query = query.eq('type', 'admin_verification_request');
    } else if (category === 'role_requests') {
      query = query.in('type', ['admin_role_request']);
    } else if (category === 'other_requests') {
      query = query.eq('type', 'admin_account_deletion_request');
    } else {
      query = query.in('type', ADMIN_ACTION_TYPES);
    }

    const { data, error: err, count } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (err) {
      setError(true);
      setLoading(false);
      return;
    }
    setTotal(count ?? 0);

    const notifList = (data as Notification[]) ?? [];

    // Batch: collect unique requester IDs and request IDs to avoid N+1 queries
    const requesterIds = [...new Set(notifList.map(n => n.requester_id).filter(Boolean))] as string[];
    const verificationIds: string[] = [];
    const userRequestIds: string[] = [];
    for (const n of notifList) {
      if (isAdminAction(n.type) && n.related_entity_id && n.related_entity_type) {
        if (n.related_entity_type === 'verification_request') verificationIds.push(n.related_entity_id);
        else userRequestIds.push(n.related_entity_id);
      }
    }

    const [profilesResult, vrResult, urResult] = await Promise.all([
      requesterIds.length
        ? supabase.from('profiles').select('id, full_name, email').in('id', requesterIds)
        : Promise.resolve({ data: null }),
      verificationIds.length
        ? supabase.from('verification_requests').select('id, status').in('id', verificationIds)
        : Promise.resolve({ data: null }),
      userRequestIds.length
        ? supabase.from('user_requests').select('id, status').in('id', userRequestIds)
        : Promise.resolve({ data: null }),
    ]);

    const profileMap = new Map((profilesResult.data ?? []).map((p: { id: string; full_name: string | null; email: string | null }) => [p.id, p]));
    const vrMap = new Map((vrResult.data ?? []).map((r: { id: string; status: string }) => [r.id, r.status]));
    const urMap = new Map((urResult.data ?? []).map((r: { id: string; status: string }) => [r.id, r.status]));

    const items: AdminNotification[] = notifList.map((notif) => {
      const enriched: AdminNotification = { ...notif };

      if (notif.requester_id) {
        enriched.user_profile = profileMap.get(notif.requester_id) as { full_name: string | null; email: string | null } | undefined;
      }

      if (isAdminAction(notif.type) && notif.related_entity_id && notif.related_entity_type) {
        const statusMap = notif.related_entity_type === 'verification_request' ? vrMap : urMap;
        const status = statusMap.get(notif.related_entity_id);
        if (status) {
          enriched.request_status = status as 'pending' | 'approved' | 'rejected';
        }
      }

      return enriched;
    });

    setNotifications(items);
    setLoading(false);
  }, [search, category, page]);

  const fetchCounts = useCallback(async () => {
    const { count: unread } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .in('type', ADMIN_ACTION_TYPES)
      .eq('is_read', false);
    setUnreadCount(unread ?? 0);

    const { count: actionReq } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .in('type', ADMIN_ACTION_TYPES)
      .eq('is_read', false);
    setActionRequiredCount(actionReq ?? 0);
  }, []);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);
  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  useRealtimeRefresh(
    [{ table: 'notifications' }],
    () => {
      fetchNotifications();
      fetchCounts();
    },
  );

  const handleMarkAsRead = useCallback(async (notifId: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', notifId);
    setNotifications((prev) =>
      prev.map((n) => (n.id === notifId ? { ...n, is_read: true } : n)),
    );
    fetchCounts();
  }, [fetchCounts]);

  const handleMarkAllRead = useCallback(async () => {
    setMarkingAll(true);
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .in('type', ADMIN_ACTION_TYPES)
      .eq('is_read', false);
    setMarkingAll(false);
    if (updateError) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    setActionRequiredCount(0);
  }, []);

  const handleNotificationClick = useCallback(async (notif: AdminNotification) => {
    if (!notif.is_read) {
      handleMarkAsRead(notif.id);
    }

    if (isAdminAction(notif.type) && notif.related_entity_id) {
      if (notif.type === 'admin_verification_request' || notif.related_entity_type === 'verification_request') {
        navigate('/admin/verification');
      } else if (notif.related_entity_type === 'user_request') {
        navigate('/admin/requests');
      }
    }
  }, [handleMarkAsRead, navigate]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const categories: { value: CategoryFilter; label: TranslationKey; count?: number }[] = [
    { value: 'all', label: 'admin.categoryAll' },
    { value: 'unread', label: 'admin.categoryUnread', count: unreadCount },
    { value: 'action_required', label: 'admin.categoryActionRequired', count: actionRequiredCount },
    { value: 'verification', label: 'admin.categoryVerification' },
    { value: 'role_requests', label: 'admin.categoryRoleRequests' },
    { value: 'other_requests', label: 'admin.categoryOtherRequests' },
  ];

  return (
    <AdminLayout>
      <div className="max-w-5xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('admin.notificationsTitle')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('admin.notificationsSubtitle')}</p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="btn-secondary btn-sm shrink-0"
            >
              {markingAll ? <Spinner size="sm" /> : <CheckCheck className="h-4 w-4" />}
              {t('admin.markAllRead')}
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('admin.totalNotifications')}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{total}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('admin.unreadCount')}</p>
            <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">{unreadCount}</p>
          </div>
          <div className="card p-4 border-amber-200 dark:border-amber-900/50">
            <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">{t('admin.actionRequired')}</p>
            <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">{actionRequiredCount}</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 rtl:right-3 rtl:left-auto" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={t('common.search')}
            className="input ltr:pl-10 rtl:pr-10"
          />
        </div>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <button
              key={cat.value}
              onClick={() => { setCategory(cat.value); setPage(0); }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                category === cat.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {t(cat.label)}
              {cat.count !== undefined && cat.count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-xs ${
                  category === cat.value ? 'bg-white/20' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                }`}>
                  {cat.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Notifications list */}
        {loading ? (
          <div className="card"><LoadingState label={t('admin.loadingNotifications')} /></div>
        ) : error ? (
          <div className="card"><ErrorState message={t('admin.failedNotifications')} onRetry={fetchNotifications} retryLabel={t('common.retry')} /></div>
        ) : notifications.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<Bell className="h-8 w-8" />}
              title={category === 'action_required' ? t('admin.noActionRequired') : t('admin.noNotifResults')}
            />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {notifications.map((notif) => {
                const isAction = isAdminAction(notif.type);
                const isPending = notif.request_status === 'pending';
                const showActionBadge = isAction && (!notif.request_status || isPending);

                return (
                  <button
                    key={notif.id}
                    onClick={() => handleNotificationClick(notif)}
                    className={`card w-full p-4 text-left transition-all hover:shadow-md ${
                      !notif.is_read ? 'ring-1 ring-primary-200 dark:ring-primary-800' : ''
                    } ${showActionBadge ? 'border-amber-300 dark:border-amber-800/60' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Left: icon */}
                      <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        isAction
                          ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}>
                        {isAction ? getActionIcon(notif.type) : <Bell className="h-4 w-4" />}
                      </div>

                      {/* Middle: content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-slate-900 dark:text-white">
                            {notif.title}
                          </span>
                          {showActionBadge && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              <AlertCircle className="h-3 w-3" />
                              {t('admin.actionRequired')}
                            </span>
                          )}
                          {notif.request_status && notif.request_status !== 'pending' && (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                              notif.request_status === 'approved'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            }`}>
                              {notif.request_status === 'approved' ? <Check className="h-3 w-3" /> : <CheckCheck className="h-3 w-3" />}
                              {t(`admin.notifStatus${notif.request_status.charAt(0).toUpperCase()}${notif.request_status.slice(1)}` as TranslationKey)}
                            </span>
                          )}
                          {!notif.is_read && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-primary-500" />
                          )}
                        </div>

                        {notif.body && (
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 line-clamp-2">{notif.body}</p>
                        )}

                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
                          {notif.user_profile && (
                            <span>
                              {notif.user_profile.full_name ?? notif.user_profile.email ?? '—'}
                            </span>
                          )}
                          <span>{t(TYPE_KEY_MAP[notif.type])}</span>
                          <span>{new Date(notif.created_at).toLocaleString()}</span>
                          {isAction && notif.related_entity_id && (
                            <span className="inline-flex items-center gap-0.5 text-primary-500 dark:text-primary-400">
                              <ExternalLink className="h-3 w-3" />
                              {t('admin.openRequest')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right: read status */}
                      <div className="shrink-0">
                        {notif.is_read ? (
                          <span className="badge-success text-xs whitespace-nowrap">
                            <Check className="h-3 w-3" />{t('admin.read')}
                          </span>
                        ) : (
                          <span className="badge-warning text-xs whitespace-nowrap">
                            {t('admin.unread')}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {t('common.page')} {page + 1} {t('common.of')} {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="btn-secondary btn-sm disabled:opacity-50"
                  >
                    {dir === 'rtl' ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                    {t('common.previous')}
                  </button>
                  <button
                    onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="btn-secondary btn-sm disabled:opacity-50"
                  >
                    {t('common.next')}
                    {dir === 'rtl' ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
