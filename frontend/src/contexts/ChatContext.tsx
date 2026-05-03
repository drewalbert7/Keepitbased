import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';
import { getSupabaseBrowserClient, isSupabaseChatConfigured } from '../lib/supabaseClient';
import {
  ChatMessage,
  fetchChatMessages,
  postChatMessage,
  toggleChatReaction as apiToggleReaction
} from '../services/chatApi';

export type ChatContextValue = {
  configured: boolean;
  messages: ChatMessage[];
  onlineCount: number;
  sending: boolean;
  sendMessage: (body: string) => Promise<void>;
  toggleReaction: (messageId: string, emoji: string) => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
};

const ChatContext = createContext<ChatContextValue | null>(null);

function displayNameFromUser(user: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string;
}): string {
  const n = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  if (n) return n;
  const em = user.email?.trim();
  if (em) return em.split('@')[0] || 'You';
  return 'You';
}

function addReactionAgg(
  reactions: ChatMessage['reactions'],
  userId: number,
  emoji: string
): ChatMessage['reactions'] {
  const next = reactions.map((r) => ({ ...r, userIds: [...r.userIds] }));
  const i = next.findIndex((r) => r.emoji === emoji);
  if (i === -1) return [...next, { emoji, count: 1, userIds: [userId] }];
  if (next[i].userIds.includes(userId)) return reactions;
  next[i] = {
    ...next[i],
    count: next[i].count + 1,
    userIds: [...next[i].userIds, userId]
  };
  return next;
}

function removeReactionAgg(
  reactions: ChatMessage['reactions'],
  userId: number,
  emoji: string
): ChatMessage['reactions'] {
  return reactions
    .map((r) => {
      if (r.emoji !== emoji) return r;
      const userIds = r.userIds.filter((id) => id !== userId);
      return { ...r, count: userIds.length, userIds };
    })
    .filter((r) => r.count > 0);
}

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const configured = isSupabaseChatConfigured();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const toggleSnap = useRef<{ messageId: string; emoji: string; wasOn: boolean } | null>(null);

  useEffect(() => {
    if (!configured || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchChatMessages({ limit: 50 });
        if (!cancelled) {
          setMessages(list);
          setHasMore(list.length >= 50);
        }
      } catch {
        if (!cancelled) toast.error('Could not load chat');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configured, user?.id]);

  useEffect(() => {
    if (!configured || !user) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const ch = supabase
      .channel('global-chat-room', {
        config: { presence: { key: String(user.id) } }
      })
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState();
        setOnlineCount(Object.keys(state).length);
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const msg: ChatMessage = {
            id: String(row.id),
            userId: Number(row.user_id),
            displayName: String(row.display_name || ''),
            body: String(row.body || ''),
            createdAt: String(row.created_at),
            reactions: []
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg].sort(
              (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_reactions' },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const messageId = String(row.message_id);
          const uid = Number(row.user_id);
          const emoji = String(row.emoji);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId ? { ...m, reactions: addReactionAgg(m.reactions || [], uid, emoji) } : m
            )
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'chat_reactions' },
        (payload) => {
          const row = payload.old as Record<string, unknown>;
          if (!row?.message_id || !row.user_id || !row.emoji) return;
          const messageId = String(row.message_id);
          const uid = Number(row.user_id);
          const emoji = String(row.emoji);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId ? { ...m, reactions: removeReactionAgg(m.reactions || [], uid, emoji) } : m
            )
          );
        }
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({ name: displayNameFromUser(user), at: new Date().toISOString() });
        }
      });

    return () => {
      void supabase.removeChannel(ch);
      setOnlineCount(0);
    };
  }, [configured, user]);

  const sendMessage = useCallback(
    async (body: string) => {
      const t = body.trim();
      if (!t || !user) return;
      if (!configured) {
        toast.error('Chat is not configured');
        return;
      }
      const tempId = `temp-${Date.now()}`;
      const optimistic: ChatMessage = {
        id: tempId,
        userId: user.id,
        displayName: displayNameFromUser(user),
        body: t,
        createdAt: new Date().toISOString(),
        reactions: [],
        optimistic: true
      };
      setMessages((prev) => [...prev, optimistic]);
      setSending(true);
      try {
        const saved = await postChatMessage(t);
        setMessages((prev) => {
          const rest = prev.filter((m) => m.id !== tempId && m.id !== saved.id);
          const merged = [
            ...rest,
            { ...saved, reactions: saved.reactions && saved.reactions.length ? saved.reactions : [] }
          ];
          return merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        });
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        toast.error('Message failed to send');
      } finally {
        setSending(false);
      }
    },
    [user, configured]
  );

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user || !configured) return;
      const uid = user.id;
      setMessages((prev) => {
        const target = prev.find((m) => m.id === messageId);
        const agg = target?.reactions?.find((r) => r.emoji === emoji);
        const wasOn = Boolean(agg?.userIds.includes(uid));
        toggleSnap.current = { messageId, emoji, wasOn };
        return prev.map((m) => {
          if (m.id !== messageId) return m;
          return {
            ...m,
            reactions: wasOn
              ? removeReactionAgg(m.reactions || [], uid, emoji)
              : addReactionAgg(m.reactions || [], uid, emoji)
          };
        });
      });
      try {
        await apiToggleReaction(messageId, emoji);
      } catch {
        const snap = toggleSnap.current;
        if (!snap || snap.messageId !== messageId || snap.emoji !== emoji) return;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m;
            return {
              ...m,
              reactions: snap.wasOn
                ? addReactionAgg(m.reactions || [], uid, emoji)
                : removeReactionAgg(m.reactions || [], uid, emoji)
            };
          })
        );
        toast.error('Could not update reaction');
      }
    },
    [user, configured]
  );

  const loadMore = useCallback(async () => {
    if (!configured || !messages.length) return;
    const oldest = messages[0];
    try {
      const more = await fetchChatMessages({ limit: 50, before: oldest.createdAt });
      if (more.length < 50) setHasMore(false);
      if (!more.length) {
        setHasMore(false);
        return;
      }
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        const older = more.filter((m) => !ids.has(m.id));
        return [...older, ...prev].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });
    } catch {
      toast.error('Could not load older messages');
    }
  }, [configured, messages]);

  const value = useMemo<ChatContextValue>(
    () => ({
      configured,
      messages,
      onlineCount,
      sending,
      sendMessage,
      toggleReaction,
      loadMore,
      hasMore
    }),
    [configured, messages, onlineCount, sending, sendMessage, toggleReaction, loadMore, hasMore]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error('useChat must be used within ChatProvider');
  }
  return ctx;
}
