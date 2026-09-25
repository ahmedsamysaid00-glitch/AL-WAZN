import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { AdminLayout } from './AdminLayout';
import { ErrorState, EmptyState } from '@/components/ui/States';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Handshake, Search, MapPin, ArrowRight } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { CollaborationWithDetails, CollaborationStatus } from '@/types/database';

const PAGE_SIZE = 10;

export function AdminCollaborations() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const [collabs, setCollabs] = useState<CollaborationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CollaborationStatus | 'all'>('all');
  const [page, setPage] = useState(0);

  const fetchCollabs = useCallback(async () => {
    setLoading(true);
    setError(false);
    let query = supabase
      .from('collaborations')
      .select('*, trips!inner(origin, destination, profiles!inner(full_name)), sender_listings!inner(product_name, origin, destination, profiles!inner(full_name))', { count: 'exact' });
    if (search.trim()) {
      const s = search.trim();
      query = query.or(`trips.origin.ilike.%${s}%,trips.destination.ilike.%${s}%,sender_listings.product_name.ilike.%${s}%,sender_listings.origin.ilike.%${s}%,sender_listings.destination.ilike.%${s}%`);
    }
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    query = query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, error: err } = await query;
    if (err) { setError(true); setLoading(false); return; }
    setCollabs((data as CollaborationWithDetails[]) ?? []);
    setLoading(false);
  }, [search, statusFilter, page]);

  useEffect(() => { fetchCollabs(); }, [fetchCollabs]);

  useRealtimeRefresh(
    [{ table: 'collaborations' }],
    () => fetchCollabs(),
  );

  const hasFilters = search.trim() || statusFilter !== 'all';

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('admin.collaborationsTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('admin.collaborationsSubtitle')}</p>
        </div>

        <div className="card p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500 ltr:left-3.5 rtl:right-3.5" />
              <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t('admin.searchUsers')} className="input ltr:pl-10 rtl:pr-10" />
            </div>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as CollaborationStatus | 'all'); setPage(0); }} className="input min-w-[160px]">
              <option value="all">{t('admin.allStatuses')}</option>
              <option value="pending">{t('collab.status.pending')}</option>
              <option value="accepted">{t('collab.status.accepted')}</option>
              <option value="rejected">{t('collab.status.rejected')}</option>
              <option value="cancelled">{t('collab.status.cancelled')}</option>
              <option value="completed">{t('collab.status.completed')}</option>
            </select>
          </div>
        </div>

        <div className="card overflow-hidden">
          {loading ? (
            <SkeletonTable rows={5} columns={8} />
          ) : error ? (
            <ErrorState message={t('admin.failedCollabs')} onRetry={fetchCollabs} retryLabel={t('common.retry')} />
          ) : collabs.length === 0 ? (
            <EmptyState icon={<Handshake className="h-8 w-8" />} title={hasFilters ? t('admin.noCollabResults') : t('empty.noCollaborations')} />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-left">
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('collab.traveler')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('collab.sender')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('collab.product')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('collab.route')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('collab.proposedWeight')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('collab.proposedPrice')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('collab.status')}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">{t('collab.createdAt')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {collabs.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{c.trips?.profiles?.full_name ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{c.sender_listings?.profiles?.full_name ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{c.sender_listings?.product_name ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {c.trips && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-primary-500" />{c.trips.origin} <ArrowRight className={`h-3 w-3 text-slate-400 dark:text-slate-500 ${arrow}`} /> {c.trips.destination}</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{c.proposed_weight_kg} kg</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{c.proposed_price}</td>
                        <td className="px-4 py-3"><StatusBadge status={c.status} t={t} /></td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{new Date(c.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-slate-100 md:hidden">
                {collabs.map((c) => (
                  <div key={c.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{c.sender_listings?.product_name ?? '—'}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{c.trips?.profiles?.full_name ?? '—'} ← → {c.sender_listings?.profiles?.full_name ?? '—'}</p>
                      </div>
                      <StatusBadge status={c.status} t={t} />
                    </div>
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      {c.trips?.origin} → {c.trips?.destination} · {c.proposed_weight_kg} kg · {c.proposed_price}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 px-4 py-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.page')} {page + 1}</p>
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary btn-sm">{t('common.previous')}</button>
                  <button onClick={() => setPage((p) => p + 1)} disabled={collabs.length < PAGE_SIZE} className="btn-secondary btn-sm">{t('common.next')}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
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
