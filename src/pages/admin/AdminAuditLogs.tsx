import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { AdminLayout } from './AdminLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { FileText, Search, X, Info } from 'lucide-react';
import type { AuditLogWithProfiles, AuditAction } from '@/types/database';

const PAGE_SIZE = 10;

const ACTION_LABELS: Record<string, string> = {
  verification_approved: 'Verification Approved',
  verification_rejected: 'Verification Rejected',
  fee_change: 'Fee Change',
  refund_approved: 'Refund Approved',
  refund_processed: 'Refund Processed',
  refund_rejected: 'Refund Rejected',
  refund_completed: 'Refund Completed',
  payment_adjusted: 'Payment Adjusted',
  payment_completed: 'Payment Completed',
  payment_held: 'Payment Held',
  payment_released: 'Payment Released',
  admin_provisioned: 'Admin Provisioned',
  user_deleted: 'User Deleted',
  message_deleted: 'Message Deleted',
  listing_cancelled: 'Listing Cancelled',
  email_change_requested: 'Email Change Requested',
  email_change_approved: 'Email Change Approved',
  email_change_rejected: 'Email Change Rejected',
  role_change_requested: 'Role Change Requested',
  role_change_approved: 'Role Change Approved',
  role_change_rejected: 'Role Change Rejected',
  account_deletion_requested: 'Account Deletion Requested',
  account_deletion_approved: 'Account Deletion Approved',
  account_deletion_rejected: 'Account Deletion Rejected',
  notification_preferences_updated: 'Notification Preferences Updated',
  currency_preference_changed: 'Currency Preference Changed',
  password_changed: 'Password Changed',
  shipment_received: 'Shipment Received',
  delivery_verified: 'Delivery Verified',
  qr_revoked: 'QR Revoked',
  qr_regenerated: 'QR Regenerated',
  receipt_uploaded: 'Receipt Uploaded',
  receipt_approved: 'Receipt Approved',
  receipt_rejected: 'Receipt Rejected',
  payout_submitted: 'Payout Submitted',
  payout_approved: 'Payout Approved',
  payout_rejected: 'Payout Rejected',
  payout_completed: 'Payout Completed',
  payment_receiving_number_changed: 'Payment Receiving Number Changed',
  marketer_assigned: 'Marketer Assigned',
  marketing_settings_changed: 'Marketing Settings Changed',
  commission_created: 'Commission Created',
  commission_approved: 'Commission Approved',
  commission_paid: 'Commission Paid',
  commission_reversed: 'Commission Reversed',
  maintenance_enabled: 'Maintenance Enabled',
  maintenance_disabled: 'Maintenance Disabled',
};

export function AdminAuditLogs() {
  const { t, dir } = useLanguage();
  const [logs, setLogs] = useState<AuditLogWithProfiles[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<AuditAction | 'all'>('all');
  const [entityTypeFilter, setEntityTypeFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [selectedLog, setSelectedLog] = useState<AuditLogWithProfiles | null>(null);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);

  const fetchEntityTypes = useCallback(async () => {
    const { data } = await supabase.from('audit_logs').select('entity_type').order('entity_type');
    if (data) {
      const unique = [...new Set(data.map((d) => d.entity_type))];
      setEntityTypes(unique);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(false);
    let query = supabase
      .from('audit_logs')
      .select(
        `*,
        admin_profile:profiles!audit_logs_admin_id_fkey(full_name),
        target_profile:profiles!audit_logs_target_user_id_fkey(full_name)`,
        { count: 'exact' },
      );
    if (search.trim()) {
      query = query.or(`reason.ilike.%${search.trim()}%,entity_id.ilike.%${search.trim()}%`);
    }
    if (actionFilter !== 'all') query = query.eq('action', actionFilter);
    if (entityTypeFilter !== 'all') query = query.eq('entity_type', entityTypeFilter);
    query = query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, error: err, count } = await query;
    if (err) {
      setError(true);
      setLoading(false);
      return;
    }
    setLogs((data as AuditLogWithProfiles[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [search, actionFilter, entityTypeFilter, page]);

  useEffect(() => {
    fetchEntityTypes();
  }, [fetchEntityTypes]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useRealtimeRefresh([{ table: 'audit_logs' }], () => fetchLogs());

  const hasFilters = search.trim() || actionFilter !== 'all' || entityTypeFilter !== 'all';

  const actionOptions = Object.keys(ACTION_LABELS).sort();

  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(dir === 'rtl' ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('admin.auditTitle')}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('admin.auditSubtitle')}
          </p>
        </div>

        {/* Filters */}
        <div className="card p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500 ltr:left-3.5 rtl:right-3.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder={t('admin.auditSearchPlaceholder')}
                className="input ltr:pl-10 rtl:pr-10"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <select
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(e.target.value as AuditAction | 'all');
                  setPage(0);
                }}
                className="input min-w-[160px]"
              >
                <option value="all">{t('admin.auditAllActions')}</option>
                {actionOptions.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABELS[a] ?? a}
                  </option>
                ))}
              </select>
              <select
                value={entityTypeFilter}
                onChange={(e) => {
                  setEntityTypeFilter(e.target.value);
                  setPage(0);
                }}
                className="input min-w-[140px]"
              >
                <option value="all">{t('admin.auditAllEntityTypes')}</option>
                {entityTypes.map((et) => (
                  <option key={et} value={et}>
                    {et}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          {loading ? (
            <LoadingState label={t('admin.auditLoading')} />
          ) : error ? (
            <ErrorState
              message={t('admin.auditFailed')}
              onRetry={fetchLogs}
              retryLabel={t('common.retry')}
            />
          ) : logs.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-8 w-8" />}
              title={hasFilters ? t('empty.noAuditLogsFiltered') : t('empty.noAuditLogs')}
            />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-left">
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
                        {t('admin.auditDate')}
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
                        {t('admin.auditAdmin')}
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
                        {t('admin.auditTarget')}
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
                        {t('admin.auditAction')}
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
                        {t('admin.auditEntityType')}
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-200 text-right">
                        {t('common.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {formatDateTime(log.created_at)}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                          {log.admin_profile?.full_name ?? t('admin.auditSystem')}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {log.target_profile?.full_name ?? t('admin.auditUnknown')}
                        </td>
                        <td className="px-4 py-3">
                          <span className="badge-accent">
                            {ACTION_LABELS[log.action] ?? log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {log.entity_type}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setSelectedLog(log)}
                            className="btn-ghost btn-sm"
                            title={t('admin.auditDetails')}
                          >
                            <Info className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => setSelectedLog(log)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <p className="font-medium text-slate-900 dark:text-white">
                          {ACTION_LABELS[log.action] ?? log.action}
                        </p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          {log.admin_profile?.full_name ?? t('admin.auditSystem')}
                        </p>
                      </div>
                      <span className="badge-accent text-xs">{log.entity_type}</span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      {formatDateTime(log.created_at)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 px-4 py-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('common.page')} {page + 1} {t('common.of')} {Math.max(1, Math.ceil(total / PAGE_SIZE))}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0 || loading}
                    className="btn-secondary btn-sm"
                  >
                    {t('common.previous')}
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={loading || (page + 1) * PAGE_SIZE >= total}
                    className="btn-secondary btn-sm"
                  >
                    {t('common.next')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setSelectedLog(null)}
          />
          <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/30">
                  <FileText className="h-5 w-5 text-accent-600 dark:text-accent-400" />
                </div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {t('admin.auditDetails')}
                </h2>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {t('admin.auditId')}
                  </p>
                  <p className="mt-1 text-sm text-slate-900 dark:text-white font-mono break-all">
                    {selectedLog.id}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {t('admin.auditCreatedAt')}
                  </p>
                  <p className="mt-1 text-sm text-slate-900 dark:text-white">
                    {formatDateTime(selectedLog.created_at)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {t('admin.auditAdmin')}
                  </p>
                  <p className="mt-1 text-sm text-slate-900 dark:text-white">
                    {selectedLog.admin_profile?.full_name ?? t('admin.auditSystem')}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {t('admin.auditTarget')}
                  </p>
                  <p className="mt-1 text-sm text-slate-900 dark:text-white">
                    {selectedLog.target_profile?.full_name ?? t('admin.auditUnknown')}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {t('admin.auditAction')}
                  </p>
                  <p className="mt-1 text-sm text-slate-900 dark:text-white">
                    <span className="badge-accent">
                      {ACTION_LABELS[selectedLog.action] ?? selectedLog.action}
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {t('admin.auditEntityType')}
                  </p>
                  <p className="mt-1 text-sm text-slate-900 dark:text-white">
                    {selectedLog.entity_type}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {t('admin.auditEntityId')}
                  </p>
                  <p className="mt-1 text-sm text-slate-900 dark:text-white font-mono break-all">
                    {selectedLog.entity_id}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {t('admin.auditReason')}
                  </p>
                  <p className="mt-1 text-sm text-slate-900 dark:text-white">
                    {selectedLog.reason ?? '—'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 dark:border-slate-700 px-6 py-4">
              <button
                onClick={() => setSelectedLog(null)}
                className="btn-secondary"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
