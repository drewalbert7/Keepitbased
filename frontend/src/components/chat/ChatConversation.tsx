import React, { useEffect, useRef, useState } from 'react';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { Link } from 'react-router-dom';
import { PaperAirplaneIcon } from '@heroicons/react/24/solid';
import { useAuth } from '../../contexts/AuthContext';
import { useChat } from '../../contexts/ChatContext';
import { CHAT_REACTION_EMOJIS } from '../../services/chatApi';
import { ChatMessageBody } from './ChatMessageBody';
import { initialsFromName } from '../../utils/chatLinkUtils';

type Props = {
  /** Tighter chrome when embedded in the floating dock */
  compact?: boolean;
};

function formatMessageTime(iso: string, compact: boolean): string {
  try {
    const d = parseISO(iso);
    if (compact) return format(d, 'p');
    if (isToday(d)) return format(d, 'p');
    if (isYesterday(d)) return `Yesterday ${format(d, 'p')}`;
    return format(d, 'MMM d, p');
  } catch {
    return '';
  }
}

export const ChatConversation: React.FC<Props> = ({ compact = false }) => {
  const { user } = useAuth();
  const { configured, messages, onlineCount, sending, sendMessage, toggleReaction, loadMore, hasMore } = useChat();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, compact ? 96 : 120)}px`;
  };

  useEffect(() => {
    resizeTextarea();
  }, [draft, compact]);

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!draft.trim() || sending) return;
    const text = draft.trim();
    setDraft('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    await sendMessage(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void onSubmit();
    }
  };

  if (!configured) {
    return (
      <div className={compact ? 'px-2 py-3' : 'mx-auto max-w-3xl px-4 py-6 sm:px-6'}>
        <div className="rounded-xl border border-amber-500/25 bg-amber-950/25 px-4 py-4 text-xs text-amber-100/95 sm:text-sm">
          <p className="font-semibold text-amber-50">Live chat is not configured</p>
          <p className="mt-2 text-amber-100/85">
            Add <code className="rounded bg-black/30 px-1 font-mono">REACT_APP_SUPABASE_URL</code> and{' '}
            <code className="rounded bg-black/30 px-1 font-mono">REACT_APP_SUPABASE_ANON_KEY</code> to the frontend env,
            and <code className="rounded bg-black/30 px-1 font-mono">SUPABASE_*</code> on the API.
          </p>
        </div>
      </div>
    );
  }

  const listClass = compact
    ? 'min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-white/[0.06] bg-gradient-to-b from-kib-card/50 to-kib-card/30 px-2 py-3'
    : 'min-h-0 flex-1 space-y-4 overflow-y-auto rounded-xl border border-white/[0.06] bg-gradient-to-b from-kib-card/50 to-kib-card/30 px-3 py-4 sm:px-4';

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      {!compact && (
        <header className="mb-4 shrink-0 rounded-xl border border-white/[0.06] bg-kib-surface/60 px-4 py-3 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-kib-fg sm:text-2xl">Community chat</h1>
              <p className="mt-0.5 text-xs text-kib-muted sm:text-sm">
                Share links, tickers, and ideas · paste URLs for previews
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/30 px-3 py-1.5 text-xs text-kib-muted">
                <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                <span className="font-medium tabular-nums text-kib-fg">{onlineCount}</span> online
              </div>
            </div>
          </div>
        </header>
      )}

      <div className={listClass}>
        {hasMore && (
          <div className="flex justify-center pb-1">
            <button type="button" onClick={() => void loadMore()} className="btn-secondary px-3 py-1 text-[11px]">
              Load older messages
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-sm font-medium text-kib-fg">No messages yet</p>
            <p className="mt-1 max-w-xs text-xs text-kib-muted">
              Say hello or paste a link — previews load automatically for https URLs.
            </p>
          </div>
        )}

        {messages.map((m) => {
          const mine = user?.id === m.userId;
          const timeLabel = formatMessageTime(m.createdAt, compact);
          const initials = initialsFromName(m.displayName);
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : 'flex-row'}`}>
              {!mine && (
                <div
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-kib-surface text-[10px] font-bold text-kib-cyber"
                  aria-hidden
                >
                  {initials}
                </div>
              )}
              <article
                className={`min-w-0 max-w-[min(100%,520px)] rounded-2xl border px-3 py-2.5 sm:px-3.5 ${
                  mine
                    ? 'rounded-br-md border-sky-500/30 bg-gradient-to-br from-[#1a3a5c] to-[#152a45] text-kib-fg shadow-[0_8px_24px_rgba(0,0,0,0.25)]'
                    : 'rounded-bl-md border-white/[0.08] bg-kib-surface/95 text-kib-fg'
                } ${m.optimistic ? 'opacity-75' : ''}`}
              >
                <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ${mine ? 'justify-end' : ''}`}>
                  <span className={`text-[11px] font-semibold sm:text-xs ${mine ? 'text-sky-200' : 'text-kib-cyber'}`}>
                    {mine ? 'You' : m.displayName}
                  </span>
                  <time className="text-[10px] tabular-nums text-kib-muted/90" dateTime={m.createdAt}>
                    {timeLabel}
                  </time>
                </div>
                <div className="mt-1.5">
                  <ChatMessageBody body={m.body} compact={compact} />
                </div>
                <div className={`mt-2 flex flex-wrap gap-1 ${mine ? 'justify-end' : ''}`}>
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
                        className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] transition-colors sm:text-xs ${
                          iReacted
                            ? 'border-kib-cyber/50 bg-kib-cyber/20 text-kib-fg'
                            : 'border-white/[0.08] bg-black/20 text-kib-muted hover:border-white/[0.14] hover:bg-white/[0.06]'
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
        className={`mt-3 shrink-0 rounded-xl border border-white/[0.08] bg-kib-surface/80 p-2 backdrop-blur-sm sm:p-2.5 ${
          compact ? '' : 'shadow-lg shadow-black/20'
        }`}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={2000}
            rows={1}
            placeholder={compact ? 'Message or paste a link…' : 'Message the room — paste links for previews (Enter to send)'}
            className="input-field min-h-[42px] max-h-[120px] flex-1 resize-none py-2.5 text-sm leading-relaxed"
            disabled={sending}
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="btn-primary flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg p-0 sm:w-auto sm:px-4"
            title="Send"
          >
            <PaperAirplaneIcon className="h-4 w-4 sm:hidden" aria-hidden />
            <span className="hidden sm:inline">{sending ? '…' : 'Send'}</span>
          </button>
        </div>
        {!compact && (
          <p className="mt-1.5 px-1 text-[10px] text-kib-muted">
            <kbd className="rounded border border-white/10 bg-black/30 px-1 font-mono">Enter</kbd> send ·{' '}
            <kbd className="rounded border border-white/10 bg-black/30 px-1 font-mono">Shift+Enter</kbd> new line · Links
            open in a new tab with preview cards
          </p>
        )}
      </form>

      {!compact && (
        <p className="mt-2 text-center text-[10px] text-kib-muted">
          Be respectful · educational discussion only ·{' '}
          <Link to="/dashboard" className="text-kib-cyber hover:underline">
            Back to dashboard
          </Link>
        </p>
      )}
    </div>
  );
};
