import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { SupportLayout } from './SupportLayout';
import { LoadingState, EmptyState } from '@/components/ui/States';
import {
  MessageSquare,
  MailOpen,
  Clock,
  Activity,
  Mail,
} from 'lucide-react';

interface SupportStats {
  openCount: number;
  unreadCount: number;
  waitingCount: number;
  recentCount: number;
}

interface RecentConversation {
  id: string;
  traveler_id: string;
  support_status: string;
  last_message_at: string | null;
  updated_at: string;
  profiles: { full_name: string | null; role: string } | null;
  last_message: { message_text: string; created_at: string } | null;
  messages?: { message_text: string; created_at: string; sender_id: string }[];
}

export function SupportDashboard() {
  const { t } = useLanguage();
  const [stats, setStats] = useState<SupportStats | null>(null);
  const [recent, setRecent] = useState<RecentConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(false);

    const [statsRes, recentRes] = await Promise.all([
      supabase.rpc('get_support_stats'),
      supabase
        .from('conversations')
        .select(`
          id,
          traveler_id,
          support_status,
          last_message_at,
          updated_at,
          profiles!conversations_traveler_id_fkey(full_name, role),
          messages!inner(message_text, created_at, sender_id)
        `)
        .eq('context_type', 'support')
        .order('updated_at', { ascending: false })
        .limit(5),
    ]);

    if (statsRes.error || recentRes.error) {
      setError(true);
      setLoading(false);
      return;
    }

    setStats(statsRes.data as SupportStats);

    const conversations = (recentRes.data ?? []) as unknown as RecentConversation[];
    const withLast = conversations.map((c) => {
      const msgs = c.messages as unknown as { message_text: string; created_at: string; sender_id: string }[];
      const last = msgs?.length > 0
        ? msgs.reduce((a, b) => new Date(a.created_at) > new Date(b.created_at) ? a : b)
        : null;
      return {
        ...c,
        last_message: last ? { message_text: last.message_text, created_at: last.created_at } : null,
        messages: undefined,
      };
    });
    setRecent(withLast);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useRealtimeRefresh(
    [{ table: 'conversations', filter: "context_type=eq.support" }, { table: 'messages' }],
    fetchAll,
    true,
  );

  if (loading) {
    return <SupportLayout><LoadingState label={t('common.loading')} /></SupportLayout>;
  }

  if (error || !stats) {
    return (
      <SupportLayout>
        <EmptyState icon={<MessageSquare className="h-8 w-8" />} title={t('support.failedConversations')} />
      </SupportLayout>
    );
  }

  const statCards = [
    { key: 'open', label: t('support.openConversations'), value: stats.openCount, icon: <MessageSquare className="h-5 w-5" />, color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' },
    { key: 'unread', label: t('support.unreadConversations'), value: stats.unreadCount, icon: <MailOpen className="h-5 w-5" />, color: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400' },
    { key: 'waiting', label: t('support.waitingForSupport'), value: stats.waitingCount, icon: <Clock className="h-5 w-5" />, color: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' },
    { key: 'recent', label: t('support.recentlyActive'), value: stats.recentCount, icon: <Activity className="h-5 w-5" />, color: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400' },
  ];

  return (
    <SupportLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('support.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('support.subtitle')}</p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {statCards.map((s) => (
            <div key={s.key} className="card p-5">
              <div className="flex items-center gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${s.color}`}>
                  {s.icon}
                </span>
                <div>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{s.value}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Support email info */}
        <div className="card p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400">
              <Mail className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t('support.supportEmail')}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('support.supportEmailDesc')}</p>
              <p className="mt-1 text-sm font-medium text-primary-600 dark:text-primary-400">ahmedsamysayed00@gmail.com</p>
            </div>
          </div>
        </div>

        {/* Recent conversations */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('support.recentConversations')}</h2>
            <Link to="/support/conversations" className="text-sm text-primary-600 dark:text-primary-400 hover:underline">
              {t('dashboard.viewAll')}
            </Link>
          </div>

          {recent.length === 0 ? (
            <div className="card p-8">
              <EmptyState icon={<MessageSquare className="h-8 w-8 text-slate-400" />} title={t('support.noConversations')} />
            </div>
          ) : (
            <div className="space-y-3">
              {recent.map((conv) => (
                <Link
                  key={conv.id}
                  to={`/support/conversations/${conv.id}`}
                  className="card flex items-center gap-4 p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
                    <MessageSquare className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                      {conv.profiles?.full_name ?? '—'}
                    </p>
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
                        : new Date(conv.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </SupportLayout>
  );
}
