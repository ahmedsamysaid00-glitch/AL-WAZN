import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { useAuth } from '@/auth/useAuth';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { SupportLayout } from './SupportLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Pagination } from '@/components/ui/Pagination';
import { MessageSquare, Search } from 'lucide-react';

const PAGE_SIZE = 20;

interface SupportConversationRow {
  id: string;
  traveler_id: string;
  support_status: string;
  assigned_to: string | null;
  last_message_at: string | null;
  updated_at: string;
  created_at: string;
  profiles: { full_name: string | null; role: string } | null;
  last_message: { message_text: string; created_at: string; sender_id: string; read_at: string | null } | null;
  unread_count: number;
}

type RoleFilter = 'all' | 'traveler' | 'sender';
type StatusFilter = 'all' | 'open' | 'closed';
type ReadFilter = 'all' | 'unread' | 'read';

export function SupportConversationsList() {
  const { t, dir } = useLanguage();
  const { profile } = useAuth();
  const [conversations, setConversations] = useState<SupportConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    setError(false);

    let query = supabase
      .from('conversations')
      .select(`
        id,
        traveler_id,
        support_status,
        assigned_to,
        last_message_at,
        updated_at,
        created_at,
        profiles!conversations_traveler_id_fkey(full_name, role)
      `)
      .eq('context_type', 'support')
      .order('updated_at', { ascending: false });

    if (statusFilter === 'open') {
      query = query.eq('support_status', 'open');
    } else if (statusFilter === 'closed') {
      query = query.eq('support_status', 'closed');
    }

    const offset = page * PAGE_SIZE;
    query = query.range(offset, offset + PAGE_SIZE - 1);

    const { data, error: err, count } = await query;

    if (err) {
      setError(true);
      setLoading(false);
      return;
    }

    const totalCount = count ?? 0;
    setTotalPages(Math.max(1, Math.ceil(totalCount / PAGE_SIZE)));

    const rows = (data ?? []) as unknown as Omit<SupportConversationRow, 'last_message' | 'unread_count'>[];

    if (rows.length === 0) {
      setConversations([]);
      setLoading(false);
      return;
    }

    const convIds = rows.map((r) => r.id);

    const [lastMsgRes, unreadRes] = await Promise.all([
      supabase
        .from('messages')
        .select('conversation_id, message_text, created_at, sender_id, read_at')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('messages')
        .select('conversation_id')
        .in('conversation_id', convIds)
        .is('read_at', null)
        .neq('sender_id', profile?.id ?? ''),
    ]);

    const lastMsgMap = new Map<string, { message_text: string; created_at: string; sender_id: string; read_at: string | null }>();
    for (const m of (lastMsgRes.data ?? []) as { conversation_id: string; message_text: string; created_at: string; sender_id: string; read_at: string | null }[]) {
      if (!lastMsgMap.has(m.conversation_id)) {
        lastMsgMap.set(m.conversation_id, m);
      }
    }

    const unreadMap = new Map<string, number>();
    for (const m of (unreadRes.data ?? []) as { conversation_id: string }[]) {
      unreadMap.set(m.conversation_id, (unreadMap.get(m.conversation_id) ?? 0) + 1);
    }

    let result: SupportConversationRow[] = rows.map((r) => ({
      ...r,
      last_message: lastMsgMap.get(r.id) ?? null,
      unread_count: unreadMap.get(r.id) ?? 0,
    }));

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter((r) => (r.profiles?.full_name ?? '').toLowerCase().includes(q));
    }
    if (roleFilter !== 'all') {
      result = result.filter((r) => r.profiles?.role === roleFilter);
    }
    if (readFilter === 'unread') {
      result = result.filter((r) => r.unread_count > 0);
    } else if (readFilter === 'read') {
      result = result.filter((r) => r.unread_count === 0);
    }

    setConversations(result);
    setLoading(false);
  }, [page, statusFilter, debouncedSearch, roleFilter, readFilter, profile?.id]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useRealtimeRefresh(
    [{ table: 'messages' }, { table: 'conversations', filter: 'context_type=eq.support' }],
    fetchConversations,
    true,
  );

  return (
    <SupportLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('support.conversationsTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('support.conversationsSubtitle')}</p>
        </div>

        {/* Filters */}
        <div className="card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                placeholder={t('support.searchPlaceholder')}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={roleFilter}
                onChange={(e) => { setRoleFilter(e.target.value as RoleFilter); setPage(0); }}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800"
              >
                <option value="all">{t('support.filterAll')}</option>
                <option value="traveler">{t('support.filterTraveler')}</option>
                <option value="sender">{t('support.filterSender')}</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(0); }}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800"
              >
                <option value="all">{t('support.filterAll')}</option>
                <option value="open">{t('support.filterOpen')}</option>
                <option value="closed">{t('support.filterClosed')}</option>
              </select>
              <select
                value={readFilter}
                onChange={(e) => { setReadFilter(e.target.value as ReadFilter); setPage(0); }}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800"
              >
                <option value="all">{t('support.filterAll')}</option>
                <option value="unread">{t('support.filterUnread')}</option>
                <option value="read">{t('support.filterRead')}</option>
              </select>
            </div>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <LoadingState label={t('support.loadingConversations')} />
        ) : error ? (
          <ErrorState message={t('support.failedConversations')} onRetry={fetchConversations} retryLabel={t('common.retry')} />
        ) : conversations.length === 0 ? (
          <div className="card p-8">
            <EmptyState icon={<MessageSquare className="h-8 w-8 text-slate-400" />} title={t('support.noConversations')} />
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {conversations.map((conv) => (
                <Link
                  key={conv.id}
                  to={`/support/conversations/${conv.id}`}
                  className={`card flex items-center gap-4 p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 ${
                    conv.unread_count > 0 ? 'border-primary-200 dark:border-primary-800' : ''
                  }`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
                    <MessageSquare className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                        {conv.profiles?.full_name ?? '—'}
                      </p>
                      {conv.unread_count > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-xs font-bold text-white">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {conv.last_message?.message_text ?? t('support.noMessagesYet')}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`badge ${conv.support_status === 'open' ? 'badge-success' : 'badge-warning'} text-xs`}>
                      {conv.support_status === 'open' ? t('support.filterOpen') : t('support.filterClosed')}
                    </span>
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                      {conv.last_message_at
                        ? new Date(conv.last_message_at).toLocaleDateString()
                        : new Date(conv.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} t={t} rtl={dir === 'rtl'} />
          </>
        )}
      </div>
    </SupportLayout>
  );
}
