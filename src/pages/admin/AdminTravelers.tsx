import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { AdminLayout } from './AdminLayout';
import { ErrorState, EmptyState } from '@/components/ui/States';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Plane, Search } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { Profile, VerificationStatus, AccountStatus } from '@/types/database';

const PAGE_SIZE = 10;

export function AdminTravelers() {
  const { t } = useLanguage();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [verificationFilter, setVerificationFilter] = useState<VerificationStatus | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AccountStatus | 'all'>('all');
  const [page, setPage] = useState(0);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(false);
    let query = supabase.from('profiles').select('*', { count: 'exact' }).eq('role', 'traveler');
    if (search.trim()) query = query.or(`email.ilike.%${search.trim()}%,full_name.ilike.%${search.trim()}%`);
    if (verificationFilter !== 'all') query = query.eq('verification_status', verificationFilter);
    if (statusFilter !== 'all') query = query.eq('account_status', statusFilter);
    query = query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, error: err } = await query;
    if (err) { setError(true); setLoading(false); return; }
    setUsers((data as Profile[]) ?? []);
    setLoading(false);
  }, [search, verificationFilter, statusFilter, page]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  useRealtimeRefresh(
    [{ table: 'profiles' }],
    () => fetchUsers(),
  );

  const hasFilters = search.trim() || verificationFilter !== 'all' || statusFilter !== 'all';

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('admin.travelersTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('admin.travelersSubtitle')}</p>
        </div>

        <div className="card p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500 ltr:left-3.5 rtl:right-3.5" />
              <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t('admin.searchUsers')} className="input ltr:pl-10 rtl:pr-10" />
            </div>
            <div className="flex gap-3">
              <select value={verificationFilter} onChange={(e) => { setVerificationFilter(e.target.value as VerificationStatus | 'all'); setPage(0); }} className="input min-w-[160px]">
                <option value="all">{t('admin.allVerification')}</option>
                <option value="unverified">{t('verification.status.unverified')}</option>
                <option value="pending">{t('verification.status.pending')}</option>
                <option value="approved">{t('verification.status.approved')}</option>
                <option value="rejected">{t('verification.status.rejected')}</option>
              </select>
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as AccountStatus | 'all'); setPage(0); }} className="input min-w-[140px]">
                <option value="all">{t('admin.allStatuses')}</option>
                <option value="pending">{t('status.pending')}</option>
                <option value="active">{t('status.active')}</option>
                <option value="suspended">{t('status.suspended')}</option>
              </select>
            </div>
          </div>
        </div>

        <div className="card overflow-hidden">
          {loading ? (
            <SkeletonTable rows={5} columns={5} />
          ) : error ? (
            <ErrorState message={t('admin.failedUsers')} onRetry={fetchUsers} retryLabel={t('common.retry')} />
          ) : users.length === 0 ? (
            <EmptyState icon={<Plane className="h-8 w-8" />} title={hasFilters ? t('admin.noResults') : t('empty.noTravelers')} />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-left">
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.name')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.email')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.filterVerification')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.status')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('admin.joined')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{u.full_name || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300 break-all">{u.email}</td>
                        <td className="px-4 py-3"><span className={verificationBadgeClass(u.verification_status)}>{verificationLabel(u.verification_status, t)}</span></td>
                        <td className="px-4 py-3"><span className={statusBadgeClass(u.account_status)}>{statusLabel(u.account_status, t)}</span></td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{new Date(u.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-slate-100 md:hidden">
                {users.map((u) => (
                  <div key={u.id} className="p-4">
                    <p className="font-medium text-slate-900 dark:text-white">{u.full_name || '—'}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 break-all">{u.email}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={verificationBadgeClass(u.verification_status)}>{verificationLabel(u.verification_status, t)}</span>
                      <span className={statusBadgeClass(u.account_status)}>{statusLabel(u.account_status, t)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 px-4 py-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.page')} {page + 1}</p>
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary btn-sm">{t('common.previous')}</button>
                  <button onClick={() => setPage((p) => p + 1)} disabled={users.length < PAGE_SIZE} className="btn-secondary btn-sm">{t('common.next')}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

function verificationLabel(s: VerificationStatus, t: (k: TranslationKey) => string): string {
  switch (s) {
    case 'unverified': return t('verification.status.unverified');
    case 'pending': return t('verification.status.pending');
    case 'approved': return t('verification.status.approved');
    case 'rejected': return t('verification.status.rejected');
  }
}
function statusLabel(s: AccountStatus, t: (k: TranslationKey) => string): string {
  switch (s) {
    case 'pending': return t('status.pending');
    case 'active': return t('status.active');
    case 'suspended': return t('status.suspended');
  }
}
function verificationBadgeClass(s: VerificationStatus): string {
  switch (s) {
    case 'unverified': return 'badge-neutral';
    case 'pending': return 'badge-warning';
    case 'approved': return 'badge-success';
    case 'rejected': return 'badge-error';
  }
}
function statusBadgeClass(s: AccountStatus): string {
  switch (s) {
    case 'pending': return 'badge-warning';
    case 'active': return 'badge-success';
    case 'suspended': return 'badge-error';
  }
}
