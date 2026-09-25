import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { UserLayout } from './UserLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { MessageSquare, MapPin, Package, ArrowRight, Clock } from 'lucide-react';
import { Pagination } from '@/components/ui/Pagination';
import type { Conversation } from '@/types/database';
import type { TranslationKey } from '@/i18n/translations';

const PAGE_SIZE = 10;

interface ConversationListItem extends Conversation {
  collaborations?: {
    trips?: { origin: string; destination: string };
    sender_listings?: { product_name: string };
  };
  other_participant?: { full_name: string | null };
  last_message?: { message_text: string; created_at: string; sender_id: string } | null;
  unread_count?: number;
}

export function UserMessagesPage() {
  const { t, dir } = useLanguage();
  const { profile } = useAuth();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const fetchingRef = useRef(false);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const fetchConversations = useCallback(async (pageNum: number) => {
    if (!profile?.id || fetchingRef.current) return;
    fetchingRef.current = true;
    setError(false);

    const uid = profile.id;
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    try {
      const { data, error: err, count } = await supabase
        .from('conversations')
        .select(`
          *,
          collaborations(
            trips(origin, destination),
            sender_listings(product_name)
          )
        `, { count: 'exact' })
        .or(`traveler_id.eq.${uid},sender_id.eq.${uid}`)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .range(from, to);

      if (err) { setError(true); setConversations([]); fetchingRef.current = false; return; }

      setTotalCount(count ?? 0);
      const items = (data as ConversationListItem[]) ?? [];

      if (items.length === 0) {
        setConversations([]);
        fetchingRef.current = false;
        return;
      }

      // ── Batch fetch: other participant names, last messages, unread counts ──
      const otherIds = items.map((c) =>
        c.traveler_id === uid ? c.sender_id : c.traveler_id,
      );
      const convIds = items.map((c) => c.id);

      const [profilesRes, lastMsgsRes, unreadRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', otherIds),
        supabase
          .from('messages')
          .select('conversation_id, message_text, created_at, sender_id')
          .in('conversation_id', convIds)
          .order('created_at', { ascending: false }),
        supabase
          .from('messages')
          .select('conversation_id')
          .in('conversation_id', convIds)
          .neq('sender_id', uid)
          .is('read_at', null),
      ]);

      const profileMap = new Map<string, string | null>();
      for (const p of (profilesRes.data ?? []) as { id: string; full_name: string | null }[]) {
        profileMap.set(p.id, p.full_name);
      }

      const lastMsgMap = new Map<string, { message_text: string; created_at: string; sender_id: string }>();
      for (const m of (lastMsgsRes.data ?? []) as { conversation_id: string; message_text: string; created_at: string; sender_id: string }[]) {
        if (!lastMsgMap.has(m.conversation_id)) {
          lastMsgMap.set(m.conversation_id, {
            message_text: m.message_text,
            created_at: m.created_at,
            sender_id: m.sender_id,
          });
        }
      }

      const unreadMap = new Map<string, number>();
      for (const m of (unreadRes.data ?? []) as { conversation_id: string }[]) {
        unreadMap.set(m.conversation_id, (unreadMap.get(m.conversation_id) ?? 0) + 1);
      }

      const enriched: ConversationListItem[] = items.map((conv) => {
        const otherId = conv.traveler_id === uid ? conv.sender_id : conv.traveler_id;
        return {
          ...conv,
          other_participant: { full_name: (otherId ? profileMap.get(otherId) : null) ?? null },
          last_message: lastMsgMap.get(conv.id) ?? null,
          unread_count: unreadMap.get(conv.id) ?? 0,
        };
      });

      setConversations(enriched);
    } catch {
      setError(true);
      setConversations([]);
    }

    fetchingRef.current = false;
  }, [profile?.id]);

  const fetchConversationsInitial = useCallback(async () => {
    setLoading(true);
    await fetchConversations(0);
    setLoading(false);
  }, [fetchConversations]);

  useEffect(() => { fetchConversationsInitial(); }, [fetchConversationsInitial]);

  useRealtimeRefresh(
    [{ table: 'conversations' }, { table: 'messages' }],
    () => fetchConversations(page),
    !!profile?.id,
  );

  const goToPage = useCallback((newPage: number) => {
    setPage(newPage);
    fetchConversations(newPage);
  }, [fetchConversations]);

  if (loading) return (
    <UserLayout>
      <div className="max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('messages.title')}</h1>
        <div className="card"><LoadingState label={t('messages.loading')} /></div>
      </div>
    </UserLayout>
  );

  if (error) return (
    <UserLayout>
      <div className="max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('messages.title')}</h1>
        <div className="card"><ErrorState message={t('messages.failed')} onRetry={() => goToPage(page)} retryLabel={t('common.retry')} /></div>
      </div>
    </UserLayout>
  );

  return (
    <UserLayout>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('messages.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('messages.subtitle')}</p>
        </div>

        {conversations.length === 0 ? (
          <div className="card"><EmptyState icon={<MessageSquare className="h-8 w-8" />} title={t('messages.empty')} /></div>
        ) : (
          <div className="space-y-3">
            {conversations.map((conv) => (
              <ConversationRow key={conv.id} conv={conv} t={t} arrow={arrow} currentUserId={profile?.id ?? ''} />
            ))}
          </div>
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={goToPage}
          t={t}
          rtl={dir === 'rtl'}
        />
      </div>
    </UserLayout>
  );
}

function ConversationRow({
  conv, t, arrow, currentUserId,
}: {
  conv: ConversationListItem;
  t: (k: TranslationKey) => string;
  arrow: string;
  currentUserId: string;
}) {
  const trip = conv.collaborations?.trips;
  const listing = conv.collaborations?.sender_listings;
  const otherName = conv.other_participant?.full_name ?? '—';
  const hasUnread = (conv.unread_count ?? 0) > 0;

  return (
    <Link
      to={`/dashboard/messages/${conv.id}`}
      className={`card card-hover p-4 animate-fade-in ${hasUnread ? 'ring-2 ring-primary-200' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
              <MessageSquare className="h-4 w-4" />
            </span>
            <span className="break-anywhere text-sm font-semibold text-slate-900 dark:text-white">{otherName}</span>
            {hasUnread && (
              <span className="badge-primary text-xs">{conv.unread_count} {t('messages.unread')}</span>
            )}
          </div>
          {trip && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-primary-400" />
              <span className="break-anywhere">{trip.origin}</span> <ArrowRight className={`h-3 w-3 shrink-0 ${arrow}`} /> <span className="break-anywhere">{trip.destination}</span>
            </div>
          )}
          {listing && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Package className="h-3.5 w-3.5 shrink-0 text-accent-400" />
              <span className="break-anywhere">{listing.product_name}</span>
            </div>
          )}
          {conv.last_message && (
            <p className={`text-xs ${hasUnread ? 'font-medium text-slate-700 dark:text-slate-300' : 'text-slate-500 dark:text-slate-400'} truncate`}>
              {conv.last_message.sender_id === currentUserId && `${t('messages.you')} `}
              {conv.last_message.message_text}
            </p>
          )}
        </div>
        <div className="shrink-0">
          {conv.last_message_at && (
            <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
              <Clock className="h-3 w-3" />
              {new Date(conv.last_message_at).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
