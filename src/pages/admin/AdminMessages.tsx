import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { AdminLayout } from './AdminLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import { MessageSquare, Search, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import type { Conversation, Message } from '@/types/database';
interface ConversationWithDetails extends Conversation {
  collaborations?: {
    trips?: { origin: string; destination: string };
    sender_listings?: { product_name: string };
  };
  traveler_profile?: { full_name: string | null };
  sender_profile?: { full_name: string | null };
}

const PAGE_SIZE = 20;

export function AdminMessages() {
  const { t } = useLanguage();
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [selectedConv, setSelectedConv] = useState<ConversationWithDetails | null>(null);
  const [convMessages, setConvMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    setError(false);

    let query = supabase.from('conversations').select('*', { count: 'exact' });

    if (search) {
      query = query.or(`collaboration_id.ilike.%${search}%`);
    }

    const { data, error: err, count } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (err) { setError(true); setLoading(false); return; }
    setTotal(count ?? 0);

    const items: ConversationWithDetails[] = [];
    for (const conv of (data as Conversation[]) ?? []) {
      const { data: collab } = await supabase
        .from('collaborations')
        .select('trips(origin, destination), sender_listings(product_name)')
        .eq('id', conv.collaboration_id)
        .maybeSingle();

      const { data: traveler } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', conv.traveler_id)
        .maybeSingle();

      const { data: sender } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', conv.sender_id)
        .maybeSingle();

      const collabData = collab as { trips: { origin: string; destination: string }[]; sender_listings: { product_name: string }[] } | null;
      const tripData = collabData?.trips?.[0];
      const listingData = collabData?.sender_listings?.[0];

      items.push({
        ...conv,
        collaborations: tripData || listingData ? {
          trips: tripData,
          sender_listings: listingData,
        } : undefined,
        traveler_profile: traveler as { full_name: string | null } | undefined,
        sender_profile: sender as { full_name: string | null } | undefined,
      });
    }

    setConversations(items);
    setLoading(false);
  }, [search, page]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  useRealtimeRefresh(
    [{ table: 'conversations' }, { table: 'messages' }],
    () => fetchConversations(),
  );

  const fetchMessages = useCallback(async (convId: string) => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    setConvMessages((data as Message[]) ?? []);
  }, []);

  const viewMessages = async (conv: ConversationWithDetails) => {
    setSelectedConv(conv);
    setLoadingMessages(true);
    await fetchMessages(conv.id);
    setLoadingMessages(false);
  };

  // Realtime: update messages when changes occur in the selected conversation
  useEffect(() => {
    if (!selectedConv) return;
    const channel = supabase
      .channel(`admin-messages:${selectedConv.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedConv.id}` },
        (payload) => {
          const newMsg = payload.new as Message;
          setConvMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
            );
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedConv.id}` },
        (payload) => {
          const oldMsg = payload.old as Message;
          setConvMessages((prev) => prev.filter((m) => m.id !== oldMsg.id));
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedConv]);

  const handleDeleteMessage = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    setDeleting(true);
    setDeleteError(null);
    const { error: err } = await supabase.rpc('admin_delete_message', { p_message_id: deleteTarget.id });
    setDeleting(false);
    setDeletingId(null);
    if (err) {
      setDeleteError(t('admin.deleteMessageFailed'));
      showToast('error', t('admin.deleteMessageFailed'));
      return;
    }
    setConvMessages((prev) => prev.filter((m) => m.id !== deleteTarget.id));
    setDeleteTarget(null);
    showToast('success', t('admin.deleteMessageSuccess'));
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (loading) return (
    <AdminLayout>
      <div className="max-w-5xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('admin.messagesTitle')}</h1>
        <div className="card"><LoadingState label={t('admin.loadingMessages')} /></div>
      </div>
    </AdminLayout>
  );

  if (error) return (
    <AdminLayout>
      <div className="max-w-5xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('admin.messagesTitle')}</h1>
        <div className="card"><ErrorState message={t('admin.failedMessages')} onRetry={fetchConversations} retryLabel={t('common.retry')} /></div>
      </div>
    </AdminLayout>
  );

  return (
    <AdminLayout>
      <div className="max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('admin.messagesTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('admin.messagesSubtitle')}</p>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('admin.totalConversations')}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{total}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('admin.totalMessages')}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{convMessages.length || '—'}</p>
          </div>
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder={t('admin.searchMessages')}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 py-2 pl-10 pr-4 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>

        {/* Conversation detail panel */}
        {selectedConv && (
          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {selectedConv.traveler_profile?.full_name ?? '—'} ↔ {selectedConv.sender_profile?.full_name ?? '—'}
              </h2>
              <button onClick={() => setSelectedConv(null)} className="btn-ghost btn-sm">{t('common.close')}</button>
            </div>
            {selectedConv.collaborations?.trips && (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {selectedConv.collaborations.trips.origin} → {selectedConv.collaborations.trips.destination}
              </p>
            )}
            {deleteError && (
              <div className="rounded-lg bg-error-50 dark:bg-error-900/20 px-3 py-2 text-xs text-error-700 dark:text-error-400">
                {deleteError}
              </div>
            )}
            {loadingMessages ? (
              <LoadingState />
            ) : convMessages.length === 0 ? (
              <EmptyState icon={<MessageSquare className="h-8 w-8" />} title={t('messages.noMessagesYet')} />
            ) : (
              <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-700 p-3">
                {convMessages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.sender_id === selectedConv.traveler_id ? 'justify-start' : 'justify-end'}`}>
                    <div className={`group max-w-[75%] rounded-lg px-3 py-2 text-sm ${msg.sender_id === selectedConv.traveler_id ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : 'bg-primary-50 dark:bg-primary-900/30 text-primary-900'}`}>
                      <p className="whitespace-pre-wrap break-words">{msg.message_text}</p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          {new Date(msg.created_at).toLocaleString()}
                          {msg.read_at && ' · ✓'}
                        </p>
                        <button
                          onClick={() => setDeleteTarget(msg)}
                          disabled={deletingId === msg.id}
                          className="text-error-500 hover:text-error-700 dark:text-error-400 dark:hover:text-error-300 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                          title={t('admin.deleteMessage')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Conversations list */}
        {conversations.length === 0 ? (
          <div className="card"><EmptyState icon={<MessageSquare className="h-8 w-8" />} title={t('admin.noMessageResults')} /></div>
        ) : (
          <>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">{t('admin.traveler')}</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">{t('admin.sender')}</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">{t('messages.tripRoute')}</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">{t('admin.notificationCreated')}</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">{t('admin.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {conversations.map((conv) => (
                    <tr key={conv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                      <td className="px-4 py-3 text-slate-900 dark:text-white">{conv.traveler_profile?.full_name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-900 dark:text-white">{conv.sender_profile?.full_name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {conv.collaborations?.trips ? `${conv.collaborations.trips.origin} → ${conv.collaborations.trips.destination}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{new Date(conv.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => viewMessages(conv)} className="btn-ghost btn-sm">
                          <MessageSquare className="h-4 w-4" />{t('admin.viewUser')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500 dark:text-slate-400">{t('common.page')} {page + 1} {t('common.of')} {totalPages}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="btn-secondary btn-sm disabled:opacity-50"
                  >
                    <ChevronLeft className="h-4 w-4" />{t('common.previous')}
                  </button>
                  <button
                    onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="btn-secondary btn-sm disabled:opacity-50"
                  >
                    {t('common.next')}<ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('admin.deleteMessage')}
        message={t('admin.confirmDeleteMessage')}
        confirmLabel={t('admin.deleteMessage')}
        cancelLabel={t('common.cancel')}
        onConfirm={handleDeleteMessage}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
        destructive
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </AdminLayout>
  );
}
