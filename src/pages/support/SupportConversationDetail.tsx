import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { SupportLayout } from './SupportLayout';
import { LoadingState, EmptyState } from '@/components/ui/States';
import { useRealtimeMessages } from '@/hooks/useRealtime';
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  ArrowLeft,
  ArrowRight,
  Send,
  MessageSquare,
  ShieldAlert,
  User as UserIcon,
  CircleDot,
  CheckCircle2,
} from 'lucide-react';
import type { Message, ConversationContextType, SupportStatus } from '@/types/database';
import { moderateMessage } from '@/lib/moderation';
import type { TranslationKey } from '@/i18n/translations';

interface ConversationDetail {
  id: string;
  traveler_id: string;
  context_type: ConversationContextType;
  support_status: SupportStatus;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  profiles: { full_name: string | null; role: string; email: string }[] | null;
}

export function SupportConversationDetail() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft;
  const { profile } = useAuth();
  const { id } = useParams();
  const { toast, showToast, dismissToast } = useToast();
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [fetchedMessages, setFetchedMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'close' | 'reopen'>('close');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchConversation = useCallback(async () => {
    if (!id) { setNotFound(true); setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('conversations')
      .select(`
        id,
        traveler_id,
        context_type,
        support_status,
        assigned_to,
        created_at,
        updated_at,
        last_message_at,
        profiles!conversations_traveler_id_fkey(full_name, role, email)
      `)
      .eq('id', id)
      .eq('context_type', 'support')
      .maybeSingle();

    if (err || !data) { setNotFound(true); setLoading(false); return; }
    setConversation(data as ConversationDetail);
    setLoading(false);
  }, [id]);

  const fetchMessages = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });
    setFetchedMessages((data as Message[]) ?? []);
  }, [id]);

  const markAsRead = useCallback(async () => {
    if (!id || !profile?.id) return;
    await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', id)
      .neq('sender_id', profile.id)
      .is('read_at', null);
  }, [id, profile?.id]);

  useEffect(() => {
    (async () => {
      await fetchConversation();
      await fetchMessages();
      await markAsRead();
    })();
  }, [fetchConversation, fetchMessages, markAsRead]);

  const messages = useRealtimeMessages(id, fetchedMessages, markAsRead);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const trimmed = messageText.trim();
    if (!trimmed || !profile?.id || !conversation) return;
    if (trimmed.length > 2000) { setSendError(t('support.messageTooLong')); return; }

    const moderation = moderateMessage(trimmed);
    if (!moderation.allowed) {
      const key: TranslationKey = moderation.category === 'phone' ? 'messages.blockedPhone'
        : moderation.category === 'email' ? 'messages.blockedEmail'
        : moderation.category === 'url' ? 'messages.blockedUrl'
        : moderation.category === 'social_media' || moderation.category === 'whatsapp' || moderation.category === 'telegram' || moderation.category === 'username' ? 'messages.blockedSocial'
        : moderation.category === 'contact_request' ? 'messages.blockedContactRequest'
        : 'support.blocked';
      setSendError(t(key));
      return;
    }

    setSending(true);
    setSendError(null);
    const { error: err } = await supabase
      .rpc('send_message', { p_conversation_id: conversation.id, p_content: trimmed });
    setSending(false);
    if (err) {
      if (err.code === '45000') {
        setSendError(t('support.blocked'));
      } else {
        setSendError(t('support.sendFailed'));
      }
      return;
    }
    setMessageText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCloseToggle = () => {
    if (!conversation) return;
    const isClosing = conversation.support_status === 'open';
    setConfirmAction(isClosing ? 'close' : 'reopen');
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (!conversation) return;
    setClosing(true);
    const newStatus = confirmAction === 'close' ? 'closed' : 'open';
    const { error } = await supabase
      .from('conversations')
      .update({ support_status: newStatus })
      .eq('id', conversation.id);

    setClosing(false);
    setConfirmOpen(false);
    if (error) {
      showToast('error', confirmAction === 'close' ? t('support.closeFailed') : t('support.reopenFailed'));
    } else {
      setConversation({ ...conversation, support_status: newStatus });
      showToast('success', confirmAction === 'close' ? t('support.closeSuccess') : t('support.reopenSuccess'));
    }
  };

  if (loading) return (
    <SupportLayout><div className="max-w-3xl"><LoadingState label={t('common.loading')} /></div></SupportLayout>
  );

  if (notFound || !conversation) return (
    <SupportLayout>
      <div className="max-w-3xl">
        <div className="card p-8 text-center">
          <p className="text-slate-600 dark:text-slate-400">{t('support.conversationNotFound')}</p>
          <Link to="/support/conversations" className="btn-secondary btn-sm mt-4">{t('support.backToConversations')}</Link>
        </div>
      </div>
    </SupportLayout>
  );

  const isOpen = conversation.support_status === 'open';

  return (
    <SupportLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <Link to="/support/conversations" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <BackIcon className={`h-4 w-4 ${arrow}`} />
          {t('support.backToConversations')}
        </Link>

        {/* User info header */}
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
              <UserIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
                {conversation.profiles?.[0]?.full_name ?? '—'}
              </h1>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className={`badge ${conversation.profiles?.[0]?.role === 'traveler' ? 'badge-success' : 'badge-primary'} text-xs`}>
                  {conversation.profiles?.[0]?.role === 'traveler' ? t('support.filterTraveler') : t('support.filterSender')}
                </span>
                <span className={`badge ${isOpen ? 'badge-success' : 'badge-warning'} text-xs`}>
                  {isOpen ? t('support.filterOpen') : t('support.filterClosed')}
                </span>
              </div>
            </div>
            <button
              onClick={handleCloseToggle}
              disabled={closing}
              className={`btn-sm ${isOpen ? 'btn-secondary' : 'btn-primary'}`}
            >
              {isOpen ? <CircleDot className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {isOpen ? t('support.closeConversation') : t('support.reopenConversation')}
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="card flex h-[400px] flex-col overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState icon={<MessageSquare className="h-8 w-8" />} title={t('support.noMessagesYet')} />
              </div>
            ) : (
              messages.map((msg) => {
                const isOwn = msg.sender_id === profile?.id;
                return (
                  <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-lg px-4 py-2.5 text-sm ${
                      isOwn ? 'bg-primary-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100'
                    }`}>
                      <p className="whitespace-pre-wrap break-words">{msg.message_text}</p>
                      <p className={`mt-1 text-xs ${isOwn ? 'text-primary-200' : 'text-slate-400 dark:text-slate-500'}`}>
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {isOwn && msg.read_at && ' · ✓✓'}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Send bar */}
          <div className="border-t border-slate-100 dark:border-slate-700 p-3">
            {sendError && (
              <div className="mb-2 flex items-start gap-2 rounded-lg bg-error-50 dark:bg-error-900/20 px-3 py-2 text-xs text-error-700 dark:text-error-400">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{sendError}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('support.typeMessage')}
                maxLength={2000}
                disabled={sending || !isOpen}
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50"
                dir={dir}
              />
              <button
                onClick={handleSend}
                disabled={sending || !messageText.trim() || !isOpen}
                className="btn-primary btn-sm"
              >
                <Send className="h-4 w-4" />
                {sending ? t('support.sending') : t('support.send')}
              </button>
            </div>
          </div>
        </div>
      </div>
      <Toast toast={toast} onDismiss={dismissToast} />
      <ConfirmDialog
        open={confirmOpen}
        title={confirmAction === 'close' ? t('support.closeConversation') : t('support.reopenConversation')}
        message={confirmAction === 'close' ? t('support.closeConfirm') : t('support.reopenConfirm')}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
        loading={closing}
      />
    </SupportLayout>
  );
}
