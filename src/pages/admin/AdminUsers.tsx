import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { useLanguage } from '@/i18n/useLanguage';
import { useAuth } from '@/auth/useAuth';
import { AdminLayout } from './AdminLayout';
import { ErrorState, EmptyState } from '@/components/ui/States';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Users, Search, Eye, Trash2, X, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { Profile, UserRole, AccountStatus } from '@/types/database';

const PAGE_SIZE = 10;

export function AdminUsers() {
  const { t } = useLanguage();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AccountStatus | 'all'>('all');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ col: string; asc: boolean }>({ col: 'created_at', asc: false });

  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(false);

    let query = supabase
      .from('profiles')
      .select('id, email, full_name, role, account_status, created_at, updated_at', { count: 'exact' });

    if (search.trim()) {
      query = query.or(`email.ilike.%${search.trim()}%,full_name.ilike.%${search.trim()}%`);
    }
    if (roleFilter !== 'all') {
      query = query.eq('role', roleFilter);
    }
    if (statusFilter !== 'all') {
      query = query.eq('account_status', statusFilter);
    }

    query = query
      .order(sort.col, { ascending: sort.asc });
    if (sort.col !== 'created_at') query = query.order('created_at', { ascending: false });
    query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    const { data, error: err } = await query;

    if (err) {
      setError(true);
      setLoading(false);
      return;
    }

    setUsers((data as Profile[]) ?? []);
    setLoading(false);
  }, [search, roleFilter, statusFilter, page, sort]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useRealtimeRefresh(
    [{ table: 'profiles' }],
    () => fetchUsers(),
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const hasFilters = search.trim() || roleFilter !== 'all' || statusFilter !== 'all';

  const toggleSort = (col: string) => {
    setSort((prev) => prev.col === col ? { col, asc: !prev.asc } : { col, asc: true });
    setPage(0);
  };
  const sortIcon = (col: string) => sort.col === col ? (sort.asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null;

  const canDelete = (u: Profile): boolean => {
    if (u.role === 'admin') return false;
    if (currentUser?.id === u.id) return false;
    return true;
  };

  const handleDeleteClick = (u: Profile) => {
    setDeleteTarget(u);
    setDeleteError(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);

    const { data, error: rpcError } = await supabase.rpc('admin_delete_user', {
      p_user_id: deleteTarget.id,
    });

    if (rpcError) {
      setDeleteError(t('admin.deleteUserFailed'));
      setDeleting(false);
      return;
    }

    const result = data as { success?: boolean; message?: string } | null;
    if (result && result.success === false) {
      setDeleteError(result.message ?? t('admin.deleteUserFailed'));
      setDeleting(false);
      return;
    }

    setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
    setToast({ type: 'success', message: t('admin.deleteUserSuccess') });
    setDeleteTarget(null);
    setDeleting(false);
  };

  const handleDeleteCancel = () => {
    setDeleteTarget(null);
    setDeleteError(null);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('admin.users')}</h1>
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
                placeholder={t('admin.searchUsers')}
                className="input ltr:pl-10 rtl:pr-10"
              />
            </div>
            <div className="flex gap-3">
              <select
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value as UserRole | 'all');
                  setPage(0);
                }}
                className="input min-w-[140px]"
              >
                <option value="all">{t('admin.allRoles')}</option>
                <option value="traveler">{t('status.traveler')}</option>
                <option value="sender">{t('status.sender')}</option>
                <option value="admin">{t('status.admin')}</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as AccountStatus | 'all');
                  setPage(0);
                }}
                className="input min-w-[140px]"
              >
                <option value="all">{t('admin.allStatuses')}</option>
                <option value="pending">{t('status.pending')}</option>
                <option value="active">{t('status.active')}</option>
                <option value="suspended">{t('status.suspended')}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          {loading ? (
            <SkeletonTable rows={5} columns={6} />
          ) : error ? (
            <ErrorState
              message={t('admin.failedUsers')}
              onRetry={fetchUsers}
              retryLabel={t('common.retry')}
            />
          ) : users.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title={hasFilters ? t('admin.noResults') : t('empty.noUsers')}
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-left">
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
                        <button onClick={() => toggleSort('full_name')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">{t('admin.name')}{sortIcon('full_name')}</button>
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
                        <button onClick={() => toggleSort('email')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">{t('admin.email')}{sortIcon('email')}</button>
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
                        <button onClick={() => toggleSort('role')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">{t('admin.role')}{sortIcon('role')}</button>
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
                        <button onClick={() => toggleSort('account_status')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">{t('admin.status')}{sortIcon('account_status')}</button>
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
                        <button onClick={() => toggleSort('created_at')} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">{t('admin.joined')}{sortIcon('created_at')}</button>
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200 text-right">{t('admin.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                          {u.full_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300 break-all">{u.email}</td>
                        <td className="px-4 py-3">
                          <span className={roleBadgeClass(u.role)}>{roleLabel(u.role, t)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={statusBadgeClass(u.account_status)}>
                            {statusLabel(u.account_status, t)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                          {new Date(u.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button className="btn-ghost btn-sm" title={t('admin.viewUser')}>
                              <Eye className="h-4 w-4" />
                            </button>
                            {canDelete(u) && (
                              <button
                                onClick={() => handleDeleteClick(u)}
                                className="inline-flex items-center justify-center rounded-lg p-2 text-error-600 hover:bg-error-50 dark:text-error-400 dark:hover:bg-error-900/30 transition-colors"
                                title={t('admin.deleteUser')}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="divide-y divide-slate-100 dark:divide-slate-700 md:hidden">
                {users.map((u) => (
                  <div key={u.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900 dark:text-white">{u.full_name || '—'}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 break-all">{u.email}</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button className="btn-ghost btn-sm">
                          <Eye className="h-4 w-4" />
                        </button>
                        {canDelete(u) && (
                          <button
                            onClick={() => handleDeleteClick(u)}
                            className="inline-flex items-center justify-center rounded-lg p-2 text-error-600 hover:bg-error-50 dark:text-error-400 dark:hover:bg-error-900/30 transition-colors"
                            title={t('admin.deleteUser')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className={roleBadgeClass(u.role)}>{roleLabel(u.role, t)}</span>
                      <span className={statusBadgeClass(u.account_status)}>
                        {statusLabel(u.account_status, t)}
                      </span>
                      <span className="badge-neutral">
                        {new Date(u.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 px-4 py-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('common.page')} {page + 1}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="btn-secondary btn-sm"
                  >
                    {t('common.previous')}
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={users.length < PAGE_SIZE}
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

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={handleDeleteCancel}
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-error-100 dark:bg-error-900/30">
                  <AlertTriangle className="h-5 w-5 text-error-600 dark:text-error-400" />
                </div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {t('admin.deleteUserTitle')}
                </h2>
              </div>
              <button
                onClick={handleDeleteCancel}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('admin.deleteUserWarning')}
              </p>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                <div className="flex justify-between gap-4">
                  <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    {t('admin.deleteUserFullName')}
                  </span>
                  <span className="text-sm font-medium text-slate-900 dark:text-white text-right">
                    {deleteTarget.full_name || '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    {t('admin.deleteUserEmail')}
                  </span>
                  <span className="text-sm font-medium text-slate-900 dark:text-white text-right break-all">
                    {deleteTarget.email}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    {t('admin.deleteUserRole')}
                  </span>
                  <span className={roleBadgeClass(deleteTarget.role)}>
                    {roleLabel(deleteTarget.role, t)}
                  </span>
                </div>
              </div>

              {deleteError && (
                <p className="text-sm text-error-600 dark:text-error-400">{deleteError}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 dark:border-slate-700 px-6 py-4">
              <button
                onClick={handleDeleteCancel}
                disabled={deleting}
                className="btn-secondary"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg bg-error-600 px-4 py-2 text-sm font-semibold text-white hover:bg-error-700 dark:bg-error-600 dark:hover:bg-error-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? t('admin.deleting') : t('admin.deleteUserConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div
            className={`flex items-center gap-3 rounded-xl px-5 py-3 shadow-lg border ${
              toast.type === 'success'
                ? 'bg-success-50 dark:bg-success-900/30 border-success-200 dark:border-success-700 text-success-800 dark:text-success-200'
                : 'bg-error-50 dark:bg-error-900/30 border-error-200 dark:border-error-700 text-error-800 dark:text-error-200'
            }`}
          >
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function roleLabel(role: UserRole, t: (k: TranslationKey) => string): string {
  switch (role) {
    case 'traveler': return t('status.traveler');
    case 'sender': return t('status.sender');
    case 'admin': return t('status.admin');
    case 'marketing': return t('status.marketing');
    case 'support': return t('support.title');
  }
}

function statusLabel(s: AccountStatus, t: (k: TranslationKey) => string): string {
  switch (s) {
    case 'pending': return t('status.pending');
    case 'active': return t('status.active');
    case 'suspended': return t('status.suspended');
  }
}

function roleBadgeClass(role: UserRole): string {
  switch (role) {
    case 'traveler': return 'badge-primary';
    case 'sender': return 'badge-accent';
    case 'admin': return 'badge-warning';
    case 'marketing': return 'badge-accent';
    case 'support': return 'badge-primary';
  }
}

function statusBadgeClass(s: AccountStatus): string {
  switch (s) {
    case 'pending': return 'badge-warning';
    case 'active': return 'badge-success';
    case 'suspended': return 'badge-error';
  }
}
