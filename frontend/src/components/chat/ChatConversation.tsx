import React, { useEffect, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../../contexts/AuthContext';
import { useChat } from '../../contexts/ChatContext';
import { CHAT_REACTION_EMOJIS } from '../../services/chatApi';

type Props = {
  /** Tighter chrome when embedded in the floating dock */
  compact?: boolean;
};

export const ChatConversation: React.FC<Props> = ({ compact = false }) => {
  const { user } = useAuth();
  const { configured, messages, onlineCount, sending, sendMessage, toggleReaction, loadMore, hasMore } = useChat();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    const text = draft;
    setDraft('');
    await sendMessage(text);
  };

  if (!configured) {
    return (
      <div className={compact ? 'px-2 py-3' : 'mx-auto max-w-3xl px-4 py-6 sm:px-6'}>
        <div className="rounded-lg border border-amber-500/25 bg-amber-950/25 px-3 py-4 text-xs text-amber-100/95 sm:text-sm">
          <p className="font-semibold text-amber-50">Live chat is not configured</p>
          <p className="mt-2 text-amber-100/85">
            Add <code className="rounded bg-black/30 px-1 font-mono">REACT_APP_SUPABASE_URL</code> and{' '}
            <code className="rounded bg-black/30 px-1 font-mono">REACT_APP_SUPABASE_ANON_KEY</code> to the frontend env,
            and <code className="rounded bg-black/30 px-1 font-mono">SUPABASE_*</code> on the API. See{' '}
            <code className="rounded bg-black/30 px-1 font-mono">supabase/README.md</code>.
          </p>
        </div>
      </div>
    );
  }

  const listClass = compact
    ? 'min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg border border-white/[0.06] bg-kib-card/40 px-2 py-2'
    : 'min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-white/[0.06] bg-kib-card/40 px-3 py-3 sm:px-4';

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      {!compact && (
        <header className="mb-3 shrink-0 border-b border-white/[0.08] pb-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-kib-fg sm:text-2xl">Live chat</h1>
              <p className="mt-0.5 text-xs text-kib-muted sm:text-sm">Global room · signed-in members only</p>
            </div>
            <div className="rounded-md border border-white/[0.08] bg-kib-surface/80 px-3 py-1.5 text-xs text-kib-muted">
              <span className="font-medium text-kib-fg">{onlineCount}</span> online
            </div>
          </div>
        </header>
      )}

      <div className={listClass}>
        {hasMore && (
          <div className="flex justify-center pb-1">
            <button type="button" onClick={() => void loadMore()} className="btn-secondary px-2 py-1 text-[11px]">
              Load older
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <p className="py-6 text-center text-xs text-kib-muted sm:text-sm">No messages yet — say hello.</p>
        )}

        {messages.map((m) => {
          const mine = user?.id === m.userId;
          const timeLabel = (() => {
            try {
              return format(parseISO(m.createdAt), compact ? 'p' : 'MMM d, p');
            } catch {
              return '';
            }
          })();
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <article
                className={`max-w-[min(100%,100%)] rounded-lg border px-2.5 py-2 sm:max-w-[min(100%,520px)] sm:rounded-xl sm:px-3 ${
                  mine
                    ? 'border-[#388bfd]/35 bg-[#1f3a5f]/90 text-kib-fg'
                    : 'border-white/[0.08] bg-kib-surface/95 text-kib-fg'
                } ${m.optimistic ? 'opacity-80' : ''}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <span className={`text-[11px] font-semibold sm:text-xs ${mine ? 'text-sky-200' : 'text-kib-cyber'}`}>
                    {m.displayName}
                    {mine ? ' · you' : ''}
                  </span>
                  <time className="text-[10px] tabular-nums text-kib-muted" dateTime={m.createdAt}>
                    {timeLabel}
                  </time>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed sm:text-sm">{m.body}</p>
                <div className="mt-1.5 flex flex-wrap gap-0.5 sm:mt-2 sm:gap-1">
                  {CHAT_REACTION_EMOJIS.map((emoji) => {
                    const agg = m.reactions?.find((r) => r.emoji === emoji);
                    const count = agg?.count ?? 0;
                    const iReacted = user?.id != null && Boolean(agg?.userIds.includes(user.id));
                    return (
                      <button
                        key={emoji}
                        type="button"
                        title={emoji}
                        onClick={() => void toggleReaction(m.id, emoji)}
                        className={`inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] transition-colors sm:gap-1 sm:px-1.5 sm:text-xs ${
                          iReacted
                            ? 'border-kib-cyber/50 bg-kib-cyber/15 text-kib-fg'
                            : 'border-white/[0.08] bg-black/20 text-kib-muted hover:border-white/[0.12] hover:bg-white/[0.06]'
                        }`}
                      >
                        <span>{emoji}</span>
                        {count > 0 ? <span className="tabular-nums text-kib-fg/90">{count}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </article>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => void onSubmit(e)}
        className={`mt-2 flex shrink-0 gap-2 border-t border-white/[0.06] pt-2 sm:mt-3 sm:pt-3 ${compact ? '' : ''}`}
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          placeholder="Message…"
          className="input-field min-h-[40px] flex-1 text-sm sm:min-h-[44px]"
          disabled={sending}
          autoComplete="off"
        />
        <button type="submit" disabled={sending || !draft.trim()} className="btn-primary shrink-0 px-3 text-sm sm:px-6">
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
};
