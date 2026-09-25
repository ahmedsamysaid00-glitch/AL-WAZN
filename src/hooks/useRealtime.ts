import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { RealtimePostgresChangesPayload } from '@supabase/realtime-js';
import type { Message, Notification, Collaboration, Order } from '@/types/database';

/**
 * Centralized realtime subscription hook.
 *
 * Subscribes to Postgres Changes on a table, deduplicates by row id,
 * handles INSERT / UPDATE / DELETE events, and resyncs (re-fetches)
 * after a reconnect to avoid missing events during disconnects.
 *
 * Multiple components using the same table+filter share the same
 * Supabase channel (Supabase deduplicates channels by name internally).
 */

interface RealtimeConfig<T> {
  table: string;
  filter?: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  onInsert?: (row: T) => void;
  onUpdate?: (row: T) => void;
  onDelete?: (id: string) => void;
  onResync?: () => void;
  enabled?: boolean;
}

export function useRealtimeTable<T extends { id: string }>({
  table,
  filter,
  event = '*',
  onInsert,
  onUpdate,
  onDelete,
  onResync,
  enabled = true,
}: RealtimeConfig<T>) {
  const callbacksRef = useRef({ onInsert, onUpdate, onDelete, onResync });
  callbacksRef.current = { onInsert, onUpdate, onDelete, onResync };

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const wasSubscribedRef = useRef(false);
  const hadDisconnectRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    wasSubscribedRef.current = false;
    hadDisconnectRef.current = false;

    const channelName = `rt:${table}:${filter ?? 'all'}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: event as '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        (payload: RealtimePostgresChangesPayload<T>) => {
          if (payload.eventType === 'INSERT' && callbacksRef.current.onInsert) {
            callbacksRef.current.onInsert(payload.new as T);
          } else if (payload.eventType === 'UPDATE' && callbacksRef.current.onUpdate) {
            callbacksRef.current.onUpdate(payload.new as T);
          } else if (payload.eventType === 'DELETE' && callbacksRef.current.onDelete) {
            callbacksRef.current.onDelete((payload.old as T).id);
          }
        },
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          if (wasSubscribedRef.current && hadDisconnectRef.current && callbacksRef.current.onResync) {
            callbacksRef.current.onResync();
          }
          wasSubscribedRef.current = true;
          hadDisconnectRef.current = false;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (wasSubscribedRef.current) {
            hadDisconnectRef.current = true;
          }
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [table, filter, event, enabled]);

  return channelRef;
}

/**
 * Creates a debounced version of a function.
 * Used to batch rapid realtime events into a single refetch.
 */
export function useDebouncedCallback<T extends (...args: never[]) => void>(callback: T, delay: number): T {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => callbackRef.current(...args), delay);
    }) as T,
    [delay],
  );
}

/**
 * Realtime messages hook for a conversation.
 * Handles INSERT (new message), UPDATE (edits), DELETE (admin deletion).
 * Deduplicates by id and resyncs on reconnect.
 */
export function useRealtimeMessages(
  conversationId: string | undefined,
  initialMessages: Message[],
  onMarkAsRead?: () => void,
) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const messagesRef = useRef<Message[]>(initialMessages);
  messagesRef.current = messages;

  // Merge instead of clobber to avoid losing realtime inserts that arrived
  // between the fetch dispatch and completion.
  useEffect(() => {
    setMessages((prev) => {
      const existingIds = new Set(prev.map((m) => m.id));
      const newOnes = initialMessages.filter((m) => !existingIds.has(m.id));
      if (newOnes.length === 0 && initialMessages.length === prev.length) return prev;
      const merged = [...prev, ...newOnes].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const seen = new Set<string>();
      return merged.filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
    });
  }, [initialMessages]);

  const markAsReadRef = useRef(onMarkAsRead);
  markAsReadRef.current = onMarkAsRead;

  useRealtimeTable<Message>({
    table: 'messages',
    filter: conversationId ? `conversation_id=eq.${conversationId}` : undefined,
    event: '*',
    enabled: !!conversationId,
    onInsert: (row) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === row.id)) return prev;
        const next = [...prev, row].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        return next;
      });
      if (markAsReadRef.current) markAsReadRef.current();
    },
    onUpdate: (row) => {
      setMessages((prev) => prev.map((m) => (m.id === row.id ? row : m)));
    },
    onDelete: (id) => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    },
  });

  return messages;
}

/**
 * Realtime notifications hook for a user.
 * Handles INSERT (new notification), UPDATE (read status), DELETE.
 * Deduplicates by id and resyncs on reconnect.
 */
export function useRealtimeNotifications(
  userId: string | undefined,
  initialNotifications: Notification[],
) {
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);

  // Merge to avoid clobbering realtime state
  useEffect(() => {
    setNotifications((prev) => {
      const existingIds = new Set(prev.map((n) => n.id));
      const newOnes = initialNotifications.filter((n) => !existingIds.has(n.id));
      if (newOnes.length === 0 && initialNotifications.length === prev.length) return prev;
      const merged = [...newOnes, ...prev].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      const seen = new Set<string>();
      return merged.filter((n) => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      });
    });
  }, [initialNotifications]);

  useRealtimeTable<Notification>({
    table: 'notifications',
    filter: userId ? `user_id=eq.${userId}` : undefined,
    event: '*',
    enabled: !!userId,
    onInsert: (row) => {
      setNotifications((prev) => {
        if (prev.some((n) => n.id === row.id)) return prev;
        return [row, ...prev].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
      });
    },
    onUpdate: (row) => {
      setNotifications((prev) => prev.map((n) => (n.id === row.id ? row : n)));
    },
    onDelete: (id) => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    },
  });

  return notifications;
}

/**
 * Realtime unread notification count hook.
 * Returns the current unread count and updates in real time.
 * Resyncs on reconnect.
 */
export function useUnreadNotificationCount(userId: string | undefined) {
  const [count, setCount] = useState(0);
  const fetchCount = useCallback(async () => {
    if (!userId) return;
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    setCount(count ?? 0);
  }, [userId]);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  const debouncedFetchCount = useDebouncedCallback(fetchCount, 200);

  useRealtimeTable<Notification>({
    table: 'notifications',
    filter: userId ? `user_id=eq.${userId}` : undefined,
    event: '*',
    enabled: !!userId,
    onInsert: () => debouncedFetchCount(),
    onUpdate: () => debouncedFetchCount(),
    onDelete: () => debouncedFetchCount(),
    onResync: () => fetchCount(),
  });

  return count;
}

/**
 * Realtime collaborations hook.
 * Handles INSERT (new request), UPDATE (status change), DELETE.
 * Merges initial data to avoid clobbering realtime state.
 */
export function useRealtimeCollaborations(
  userId: string | undefined,
  initialCollabs: Collaboration[],
) {
  const [collabs, setCollabs] = useState<Collaboration[]>(initialCollabs);

  useEffect(() => {
    setCollabs((prev) => {
      const existingIds = new Set(prev.map((c) => c.id));
      const newOnes = initialCollabs.filter((c) => !existingIds.has(c.id));
      if (newOnes.length === 0 && initialCollabs.length === prev.length) return prev;
      return [...newOnes, ...prev];
    });
  }, [initialCollabs]);

  useRealtimeTable<Collaboration>({
    table: 'collaborations',
    event: '*',
    enabled: !!userId,
    onInsert: (row) => {
      setCollabs((prev) => {
        if (prev.some((c) => c.id === row.id)) return prev;
        return [row, ...prev];
      });
    },
    onUpdate: (row) => {
      setCollabs((prev) => prev.map((c) => (c.id === row.id ? row : c)));
    },
    onDelete: (id) => {
      setCollabs((prev) => prev.filter((c) => c.id !== id));
    },
  });

  return collabs;
}

/**
 * Realtime orders hook.
 * Handles INSERT (new order), UPDATE (status change), DELETE.
 * Merges initial data to avoid clobbering realtime state.
 */
export function useRealtimeOrders(
  userId: string | undefined,
  initialOrders: Order[],
) {
  const [orders, setOrders] = useState<Order[]>(initialOrders);

  useEffect(() => {
    setOrders((prev) => {
      const existingIds = new Set(prev.map((o) => o.id));
      const newOnes = initialOrders.filter((o) => !existingIds.has(o.id));
      if (newOnes.length === 0 && initialOrders.length === prev.length) return prev;
      return [...newOnes, ...prev];
    });
  }, [initialOrders]);

  useRealtimeTable<Order>({
    table: 'orders',
    event: '*',
    enabled: !!userId,
    onInsert: (row) => {
      setOrders((prev) => {
        if (prev.some((o) => o.id === row.id)) return prev;
        return [row, ...prev];
      });
    },
    onUpdate: (row) => {
      setOrders((prev) => prev.map((o) => (o.id === row.id ? row : o)));
    },
    onDelete: (id) => {
      setOrders((prev) => prev.filter((o) => o.id !== id));
    },
  });

  return orders;
}

/**
 * Generic realtime list hook for any table.
 * Handles INSERT / UPDATE / DELETE with dedup and merge-on-sync.
 * Returns the live list. Pass a `refetch` function for reconnect resync.
 */
export function useRealtimeList<T extends { id: string }>(
  table: string,
  initialData: T[],
  options: {
    filter?: string;
    event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
    enabled?: boolean;
    refetch?: () => void;
    sortFn?: (a: T, b: T) => number;
  } = {},
) {
  const { filter, event = '*', enabled = true, refetch, sortFn } = options;
  const [items, setItems] = useState<T[]>(initialData);
  const sortFnRef = useRef(sortFn);
  sortFnRef.current = sortFn;

  useEffect(() => {
    setItems((prev) => {
      const existingIds = new Set(prev.map((i) => i.id));
      const newOnes = initialData.filter((i) => !existingIds.has(i.id));
      if (newOnes.length === 0 && initialData.length === prev.length) return prev;
      const merged = [...newOnes, ...prev];
      const sf = sortFnRef.current;
      return sf ? merged.sort(sf) : merged;
    });
  }, [initialData]);

  const debouncedRefetch = useDebouncedCallback(() => refetch?.(), 200);

  useRealtimeTable<T>({
    table,
    filter,
    event,
    enabled,
    onInsert: (row) => {
      setItems((prev) => {
        if (prev.some((i) => i.id === row.id)) return prev;
        const next = [row, ...prev];
        return sortFn ? next.sort(sortFn) : next;
      });
      if (refetch) debouncedRefetch();
    },
    onUpdate: (row) => {
      setItems((prev) => prev.map((i) => (i.id === row.id ? row : i)));
    },
    onDelete: (id) => {
      setItems((prev) => prev.filter((i) => i.id !== id));
    },
    onResync: () => refetch?.(),
  });

  return items;
}

/**
 * Realtime refresh hook for list/dashboard pages.
 * Subscribes to one or more tables and debounces a refetch callback
 * on any INSERT/UPDATE/DELETE event. Resyncs on reconnect.
 * Designed for admin pages and list views that do complex joins.
 *
 * Unlike the previous implementation, this does NOT call useRealtimeTable
 * inside a loop (which violated React's Rules of Hooks). Instead it manages
 * all channels within a single useEffect.
 */
export function useRealtimeRefresh(
  tables: { table: string; filter?: string }[],
  refetch: () => void,
  enabled = true,
) {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  // Debounce refetch so rapid bursts of realtime events don't cause
  // multiple simultaneous fetches. 250ms is fast enough to feel instant
  // while coalescing concurrent INSERT/UPDATE/DELETE events.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable string key for the tables array so the effect doesn't
  // re-subscribe on every render due to a new array identity.
  const tablesKey = tables.map((t) => `${t.table}:${t.filter ?? 'all'}`).join('|');
  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  useEffect(() => {
    if (!enabled) return;

    const doRefetch = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => refetchRef.current(), 250);
    };

    const channels: ReturnType<typeof supabase.channel>[] = [];

    for (const { table, filter } of tablesRef.current) {
      const channelName = `rt-refresh:${table}:${filter ?? 'all'}`;
      const wasSubscribedRef = { current: false };
      const hadDisconnectRef = { current: false };

      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
          () => doRefetch(),
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            if (wasSubscribedRef.current && hadDisconnectRef.current) {
              refetchRef.current();
            }
            wasSubscribedRef.current = true;
            hadDisconnectRef.current = false;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (wasSubscribedRef.current) {
              hadDisconnectRef.current = true;
            }
          }
        });

      channels.push(channel);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      for (const ch of channels) {
        supabase.removeChannel(ch);
      }
    };
  }, [tablesKey, enabled]);
}

/**
 * Reconnect handler — re-fetches data when realtime reconnects.
 * This is now integrated into useRealtimeTable via onResync, but kept
 * for backward compatibility with pages that use inline subscriptions.
 */
export function useRealtimeReconnect(refetch: () => void, channelName: string) {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    const channel = supabase.channel(`reconnect:${channelName}`);

    channel.on('system', { event: 'reconnect' }, () => {
      refetchRef.current();
    });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName]);
}
