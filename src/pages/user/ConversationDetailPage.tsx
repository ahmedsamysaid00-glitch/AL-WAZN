import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { UserLayout } from './UserLayout';
import { LoadingState, EmptyState } from '@/components/ui/States';
import { MapPin, Package, ArrowRight, ArrowLeft, Send, MessageSquare, ShieldAlert } from 'lucide-react';
import { useRealtimeMessages } from '@/hooks/useRealtime';
import type { Conversation, Message } from '@/types/database';
import { moderateMessage } from '@/lib/moderation';
import type { TranslationKey } from '@/i18n/translations';

interface ConversationDetail extends Conversation {
  collaborations?: {
    trips?: { origin: string; destination: string };
    sender_listings?: { product_name: string };
  };
}

export function ConversationDetailPage() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const { profile } = useAuth();
  const { id } = useParams();
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [fetchedMessages, setFetchedMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [otherName, setOtherName] = useState('—');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchConversation = useCallback(async () => {
    if (!id) { setNotFound(true); setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('conversations')
      .select(`
        *,
        collaborations(
          trips(origin, destination),
          sender_listings(product_name)
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (err || !data) { setNotFound(true); setLoading(false); return; }
    const conv = data as ConversationDetail;
    setConversation(conv);

    const otherId = conv.traveler_id === profile?.id ? conv.sender_id : conv.traveler_id;
    const { data: otherProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', otherId)
      .maybeSingle();
    setOtherName(otherProfile?.full_name ?? '—');

    setLoading(false);
  }, [id, profile?.id]);

  const fetchConversationInitial = useCallback(async () => {
    setNotFound(false);
    await fetchConversation();
  }, [fetchConversation]);

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
      await fetchConversationInitial();
      await fetchMessages();
      await markAsRead();
    })();
  }, [fetchConversationInitial, fetchMessages, markAsRead]);

  // Realtime messages with deduplication and DELETE handling
  const messages = useRealtimeMessages(id, fetchedMessages, markAsRead);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const trimmed = messageText.trim();
    if (!trimmed || !profile?.id || !conversation) return;
    if (trimmed.length > 2000) { setSendError(t('messages.messageTooLong')); return; }

    // Frontend moderation pre-check (instant feedback)
    const moderation = moderateMessage(trimmed);
    if (!moderation.allowed) {
      const key = moderation.category === 'phone' ? 'messages.blockedPhone'
        : moderation.category === 'email' ? 'messages.blockedEmail'
        : moderation.category === 'url' ? 'messages.blockedUrl'
        : moderation.category === 'social_media' || moderation.category === 'whatsapp' || moderation.category === 'telegram' || moderation.category === 'username' ? 'messages.blockedSocial'
        : moderation.category === 'contact_request' ? 'messages.blockedContactRequest'
        : 'messages.blocked';
      setSendError(t(key as TranslationKey));
      return;
    }

    setSending(true);
    setSendError(null);
    const { error: err } = await supabase
      .rpc('send_message', { p_conversation_id: conversation.id, p_content: trimmed });
    setSending(false);
    if (err) {
      // Backend moderation rejection (ERRCODE 45000) or other error
      if (err.code === '45000') {
        setSendError(t('messages.blocked'));
      } else {
        setSendError(t('messages.sendFailed'));
      }
      return;
    }
    setMessageText('');
    // Realtime INSERT event will add the message to the UI automatically
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading) return (
    <UserLayout><div className="max-w-3xl"><div className="flex justify-center py-12"><LoadingState /></div></div></UserLayout>
  );

  if (notFound || !conversation) return (
    <UserLayout>
      <div className="max-w-3xl">
        <div className="card p-8 text-center">
          <p className="text-slate-600 dark:text-slate-400">{t('messages.notFound')}</p>
          <Link to="/dashboard/messages" className="btn-secondary btn-sm mt-4">{t('messages.backToMessages')}</Link>
        </div>
      </div>
    </UserLayout>
  );

  const trip = conversation.collaborations?.trips;
  const listing = conversation.collaborations?.sender_listings;

  return (
    <UserLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <Link to="/dashboard/messages" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className={`h-4 w-4 ${arrow}`} />
          {t('messages.backToMessages')}
        </Link>

        {/* Conversation header */}
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
              <MessageSquare className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="break-anywhere text-lg font-semibold text-slate-900 dark:text-white">{otherName}</h1>
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
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="card flex h-[400px] flex-col overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState icon={<MessageSquare className="h-8 w-8" />} title={t('messages.noMessagesYet')} />
              </div>
            ) : (
              messages.map((msg) => {
                const isOwn = msg.sender_id === profile?.id;
                return (
                  <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-lg px-4 py-2.5 text-sm ${isOwn ? 'bg-primary-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100'}`}>
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
                placeholder={t('messages.typeMessage')}
                maxLength={2000}
                disabled={sending}
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50"
                dir={dir}
              />
              <button
                onClick={handleSend}
                disabled={sending || !messageText.trim()}
                className="btn-primary btn-sm"
              >
                <Send className="h-4 w-4" />
                {sending ? t('messages.sending') : t('messages.send')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </UserLayout>
  );
}
